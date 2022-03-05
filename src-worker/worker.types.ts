export interface ProxyData {
  id: number
  ip: string
  http_port: number
  username: string
  password: string
}

export interface SiteData {
  atack: number
  id: number
  // eslint-disable-next-line camelcase
  need_parse_url: number
  url: string
  // eslint-disable-next-line camelcase
  page_time: number
}

export interface TargetData {
  site: SiteData
  proxy: Array<ProxyData>
}

export type DoserEventType = 'atack' | 'error'
