import React, { Component } from 'react'
import { Button, ButtonGroup, Tag, Callout } from '@blueprintjs/core'
import { clipboard, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import LZString from './lz-string'
import './index.css'

export const windowMode = false

const { getStore, APPDATA_PATH } = window

const REPLAYER_URL = 'https://kc3kai.github.io/kancolle-replay/battleplayer.html'
const STORAGE_FILE = path.join(APPDATA_PATH, 'kc3-replay-export.json')
const MAX_SORTIES = 50

// 各类战斗报文归类（path 已去掉 /kcsapi/ 前缀）
const DAY_BATTLE_PATHS = new Set([
    'api_req_sortie/battle',
    'api_req_sortie/airbattle',
    'api_req_sortie/ld_airbattle',
    'api_req_sortie/ld_shooting',
    'api_req_sortie/night_to_day',
    'api_req_combined_battle/battle',
    'api_req_combined_battle/battle_water',
    'api_req_combined_battle/airbattle',
    'api_req_combined_battle/ld_airbattle',
    'api_req_combined_battle/ld_shooting',
    'api_req_combined_battle/ec_battle',
    'api_req_combined_battle/each_battle',
    'api_req_combined_battle/each_battle_water',
    'api_req_combined_battle/ec_night_to_day',
])

const NIGHT_BATTLE_PATHS = new Set([
    'api_req_battle_midnight/battle',
    'api_req_battle_midnight/sp_midnight',
    'api_req_combined_battle/midnight_battle',
    'api_req_combined_battle/sp_midnight',
    'api_req_combined_battle/ec_midnight_battle',
])

const RESULT_PATHS = new Set([
    'api_req_sortie/battleresult',
    'api_req_combined_battle/battleresult',
    'api_req_practice/battle_result',
])

const clone = (obj) => JSON.parse(JSON.stringify(obj || {}))

// 舰队快照 → replay 格式 {mst_id, level, kyouka, morale, equip, stars, ace}
const buildFleet = (fleet, ships, equips) => {
    if (!fleet || !fleet.api_ship) return []
    const result = []
    fleet.api_ship.forEach((rosterId) => {
        if (rosterId <= 0) return
        const ship = ships[rosterId]
        if (!ship) return
        const equip = []
        const stars = []
        const ace = []
        const pushEquip = (equipRosterId, emptyValue) => {
            const item = equips[equipRosterId]
            equip.push(item ? item.api_slotitem_id : emptyValue)
            stars.push((item && item.api_level) || 0)
            ace.push((item && item.api_alv) || 0)
        }
        ;(ship.api_slot || []).forEach(id => pushEquip(id, 0))
        if (ship.api_slot_ex > 0) pushEquip(ship.api_slot_ex, 0)
        result.push({
            mst_id: ship.api_ship_id,
            level: ship.api_lv,
            kyouka: ship.api_kyouka || [0, 0, 0, 0, 0],
            morale: ship.api_cond != null ? ship.api_cond : 49,
            equip,
            stars,
            ace,
        })
    })
    return result
}

// 基地航空队快照（仅当前出击海域）
const buildLbas = (world) => {
    const airbase = getStore('info.airbase') || []
    const equips = getStore('info.equips') || {}
    return airbase
        .filter(squad => squad && squad.api_area_id === world)
        .map(squad => ({
            rid: squad.api_rid,
            action: squad.api_action_kind,
            planes: (squad.api_plane_info || [])
                .filter(plane => plane && plane.api_slotid > 0)
                .map((plane) => {
                    const item = equips[plane.api_slotid]
                    return {
                        mst_id: item ? item.api_slotitem_id : 0,
                        count: plane.api_count,
                        state: plane.api_state,
                        morale: plane.api_cond,
                        stars: (item && item.api_level) || 0,
                        ace: (item && item.api_alv) || 0,
                    }
                }),
        }))
}

// 海域血条/难度信息
const buildMapInfo = (world, mapnum) => {
    const maps = getStore('info.maps') || {}
    const map = maps[`${world}${mapnum}`] || {}
    const info = { diff: 0 }
    if (map.api_defeat_count != null) info.defeat_count = map.api_defeat_count
    if (map.api_required_defeat_count != null) info.required_defeat_count = map.api_required_defeat_count
    const eventmap = map.api_eventmap
    if (eventmap) {
        if (eventmap.api_now_maphp != null) {
            info.now_maphp = eventmap.api_now_maphp
            info.max_maphp = eventmap.api_max_maphp
        }
        if (eventmap.api_selected_rank != null) info.diff = eventmap.api_selected_rank
        if (eventmap.api_gauge_type != null) info.eventmap = { api_gauge_type: eventmap.api_gauge_type }
    }
    return info
}

class Recorder {
    constructor() {
        this.current = null
        this.sorties = []
        this.counter = 0
        this.listeners = []
        this.handleResponse = this.handleResponse.bind(this)
        this.load()
    }

    subscribe(callback) {
        this.listeners.push(callback)
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback)
        }
    }

    emit() {
        this.listeners.forEach((cb) => {
            try { cb() } catch (e) { console.error(e) }
        })
    }

    load() {
        try {
            const data = JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8'))
            this.sorties = data.sorties || []
            this.counter = data.counter || this.sorties.length
        } catch (e) { /* 首次使用无存档 */ }
    }

    save() {
        try {
            fs.writeFileSync(STORAGE_FILE, JSON.stringify({ counter: this.counter, sorties: this.sorties }))
        } catch (e) {
            console.error('[kc3-replay] failed to save', e)
        }
    }

    snapshotFleets(target) {
        const fleets = getStore('info.fleets') || []
        const ships = getStore('info.ships') || {}
        const equips = getStore('info.equips') || {}
        for (let i = 0; i < 4; i++) {
            target[`fleet${i + 1}`] = buildFleet(fleets[i], ships, equips)
        }
    }

    startSortie(body, postBody) {
        const world = parseInt(postBody.api_maparea_id, 10)
        const mapnum = parseInt(postBody.api_mapinfo_no, 10)
        const basic = getStore('info.basic') || {}
        this.counter += 1
        this.current = {
            id: this.counter,
            world,
            mapnum,
            fleetnum: parseInt(postBody.api_deck_id, 10) || 1,
            combined: getStore('sortie.combinedFlag') || 0,
            support1: 0,
            support2: 0,
            hqlvl: basic.api_level || 120,
            time: Math.floor(Date.now() / 1000),
            battles: [],
            ...buildMapInfo(world, mapnum),
        }
        this.snapshotFleets(this.current)
        const lbas = buildLbas(world)
        if (lbas.length) this.current.lbas = lbas
        this.pendingNode = body.api_no
        this.emit()
    }

    // 演习：没有 map/start，收到演习战斗报文时构造一次伪出击
    startPractice(postBody) {
        const basic = getStore('info.basic') || {}
        this.counter += 1
        this.current = {
            id: this.counter,
            world: -1,
            mapnum: 0,
            fleetnum: parseInt((postBody || {}).api_deck_id, 10) || 1,
            combined: 0,
            support1: 0,
            support2: 0,
            hqlvl: basic.api_level || 120,
            time: Math.floor(Date.now() / 1000),
            diff: 0,
            battles: [],
            isPractice: true,
        }
        this.snapshotFleets(this.current)
        this.pendingNode = 1
    }

    ensureBattle() {
        const battles = this.current.battles
        const last = battles[battles.length - 1]
        if (last && last.node === this.pendingNode) return last
        const battle = {
            sortie_id: this.current.id,
            node: this.pendingNode,
            data: {},
            yasen: {},
            enemyId: 0,
            time: Math.floor(Date.now() / 1000),
        }
        battles.push(battle)
        return battle
    }

    finalize() {
        if (!this.current) return
        const sortie = this.current
        this.current = null
        this.pendingNode = null
        const hasBattle = sortie.battles.some(
            battle => Object.keys(battle.data).length || Object.keys(battle.yasen).length,
        )
        if (hasBattle) {
            this.sorties.unshift(sortie)
            if (this.sorties.length > MAX_SORTIES) this.sorties.length = MAX_SORTIES
            this.save()
        }
        this.emit()
    }

    clear() {
        this.sorties = []
        this.save()
        this.emit()
    }

    handleResponse(e) {
        try {
            const { path: rawPath, body, postBody } = e.detail
            const apiPath = rawPath.replace(/^\/kcsapi\//, '')

            if (apiPath === 'api_req_map/start') {
                this.finalize()
                this.startSortie(body, postBody)
                return
            }
            if (apiPath === 'api_port/port') {
                this.finalize()
                return
            }
            if (apiPath === 'api_req_map/next') {
                if (this.current) this.pendingNode = body.api_no
                return
            }
            if (apiPath === 'api_req_practice/battle' || apiPath === 'api_req_practice/midnight_battle') {
                if (apiPath === 'api_req_practice/battle') {
                    this.finalize()
                    this.startPractice(postBody)
                }
                if (!this.current) return
                const battle = this.ensureBattle()
                if (apiPath === 'api_req_practice/battle') battle.data = clone(body)
                else battle.yasen = clone(body)
                this.emit()
                return
            }
            if (!this.current) return
            if (DAY_BATTLE_PATHS.has(apiPath)) {
                const battle = this.ensureBattle()
                battle.data = clone(body)
                this.emit()
            } else if (NIGHT_BATTLE_PATHS.has(apiPath)) {
                const battle = this.ensureBattle()
                battle.yasen = clone(body)
                this.emit()
            } else if (RESULT_PATHS.has(apiPath)) {
                const battle = this.current.battles[this.current.battles.length - 1]
                if (!battle) return
                battle.rating = body.api_win_rank
                battle.drop = (body.api_get_ship && body.api_get_ship.api_ship_id) || 0
                battle.baseEXP = body.api_get_base_exp
                battle.hqEXP = body.api_get_exp
                if (body.api_mvp != null) battle.mvp = [body.api_mvp]
                if (this.current.isPractice) this.finalize()
                else this.emit()
            }
        } catch (err) {
            console.error('[kc3-replay] error while recording', err)
        }
    }
}

const recorder = new Recorder()

export const pluginDidLoad = () => {
    window.addEventListener('game.response', recorder.handleResponse)
}

export const pluginWillUnload = () => {
    window.removeEventListener('game.response', recorder.handleResponse)
}

const buildReplayJson = (sortie) => {
    const data = { ...sortie }
    delete data.isPractice
    return JSON.stringify(data)
}

const buildReplayUrl = (sortie) =>
    `${REPLAYER_URL}#fromLZString=${LZString.compressToEncodedURIComponent(buildReplayJson(sortie))}`

const openInNewWindow = (url) => {
    try {
        const { BrowserWindow } = window.remote
        const win = new BrowserWindow({
            width: 1200,
            height: 900,
            webPreferences: { nodeIntegration: false, contextIsolation: true },
        })
        win.loadURL(url)
    } catch (e) {
        // 部分 poi 版本未暴露 remote，退回默认浏览器
        shell.openExternal(url)
    }
}

const describeSortie = (sortie) => {
    const time = new Date(sortie.time * 1000)
    const pad = n => String(n).padStart(2, '0')
    const timeText = `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`
    const mapText = sortie.isPractice ? '演习' : `${sortie.world}-${sortie.mapnum}`
    const ratings = sortie.battles.map(battle => battle.rating || '?').join('/')
    return { timeText, mapText, ratings }
}

export const reactClass = class KC3ReplayExport extends Component {
    state = {
        sorties: recorder.sorties,
        recording: !!recorder.current,
        message: '',
    }

    componentDidMount() {
        this.unsubscribe = recorder.subscribe(() => {
            this.setState({
                sorties: recorder.sorties.slice(),
                recording: !!recorder.current,
            })
        })
    }

    componentWillUnmount() {
        if (this.unsubscribe) this.unsubscribe()
    }

    notify = (message) => {
        this.setState({ message })
        clearTimeout(this.messageTimer)
        this.messageTimer = setTimeout(() => this.setState({ message: '' }), 3000)
    }

    openReplay = (sortie) => {
        openInNewWindow(buildReplayUrl(sortie))
    }

    openExternal = (sortie) => {
        shell.openExternal(buildReplayUrl(sortie))
    }

    copyUrl = (sortie) => {
        clipboard.writeText(buildReplayUrl(sortie))
        this.notify('回放链接已复制到剪贴板')
    }

    copyJson = (sortie) => {
        clipboard.writeText(buildReplayJson(sortie))
        this.notify('回放 JSON 已复制到剪贴板（可粘贴至回放页面 Load from text）')
    }

    clearAll = () => {
        recorder.clear()
        this.notify('记录已清空')
    }

    render() {
        const { sorties, recording, message } = this.state
        const currentBattles = recorder.current ? recorder.current.battles.length : 0
        return (
            <div id="kc3-replay-export" className="kc3-replay-export">
                <h2>KC3改 战斗回放导出</h2>
                <div className="status-row">
                    {recording
                        ? <Tag intent="success">记录中：{recorder.current.world}-{recorder.current.mapnum}（已记录 {currentBattles} 战，回港后保存）</Tag>
                        : <Tag minimal>待机中：出击后自动记录战斗</Tag>}
                    <Button small minimal icon="trash" onClick={this.clearAll} disabled={!sorties.length}>
                        清空记录
                    </Button>
                </div>

                {message && <Callout intent="primary" className="notify">{message}</Callout>}

                {!sorties.length && (
                    <Callout className="notify">
                        暂无记录。出击并完成至少一场战斗，回到母港后将在此列出，
                        可一键在 KC3改 Battle Replayer 中回放。
                    </Callout>
                )}

                <div className="sortie-list">
                    {sorties.map((sortie) => {
                        const { timeText, mapText, ratings } = describeSortie(sortie)
                        return (
                            <div className="sortie-item" key={`${sortie.id}-${sortie.time}`}>
                                <div className="sortie-info">
                                    <span className="sortie-map">{mapText}</span>
                                    <span className="sortie-time">{timeText}</span>
                                    <span className="sortie-ratings">{sortie.battles.length} 战 [{ratings}]</span>
                                </div>
                                <ButtonGroup>
                                    <Button small icon="play" intent="primary" onClick={() => this.openReplay(sortie)}>
                                        回放
                                    </Button>
                                    <Button small icon="globe" onClick={() => this.openExternal(sortie)}>
                                        浏览器打开
                                    </Button>
                                    <Button small icon="link" onClick={() => this.copyUrl(sortie)}>
                                        复制链接
                                    </Button>
                                    <Button small icon="clipboard" onClick={() => this.copyJson(sortie)}>
                                        复制JSON
                                    </Button>
                                </ButtonGroup>
                            </div>
                        )
                    })}
                </div>
            </div>
        )
    }
}
