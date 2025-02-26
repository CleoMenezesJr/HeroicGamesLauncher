/**
 * @file  Defines functions to update, download or remove available
 *        tool releases.
 */

import Store from 'electron-store'
import { existsSync, mkdirSync, rmSync } from 'graceful-fs'
import { logError, logInfo, LogPrefix, logWarning } from '../logger/logger'
import { WineVersionInfo } from './types'

import {
  getAvailableVersions,
  installVersion,
  ProgressInfo,
  Repositorys,
  State,
  VersionInfo
} from 'heroic-wine-downloader'
import { heroicToolsPath } from '../constants'

const wineDownloaderInfoStore = new Store({
  cwd: 'store',
  name: 'wine-downloader-info'
})

async function updateWineVersionInfos(
  fetch = false,
  count = 50
): Promise<WineVersionInfo[]> {
  let releases: WineVersionInfo[] = []

  logInfo('Updating wine versions info', LogPrefix.WineDownloader)
  if (fetch) {
    logInfo('Fetching upstream information...', LogPrefix.WineDownloader)
    await getAvailableVersions({
      repositorys: [
        Repositorys.WINEGE,
        Repositorys.PROTONGE,
        Repositorys.WINELUTRIS
      ],
      count
    })
      .then((response) => (releases = response as WineVersionInfo[]))
      .catch((error) => {
        throw error
      })

    if (wineDownloaderInfoStore.has('wine-releases')) {
      const old_releases = wineDownloaderInfoStore.get(
        'wine-releases'
      ) as WineVersionInfo[]

      old_releases.forEach((old) => {
        const index = releases.findIndex((release) => {
          return release?.version === old?.version
        })

        if (existsSync(old?.installDir)) {
          if (index !== -1) {
            releases[index].installDir = old.installDir
            releases[index].isInstalled = old.isInstalled
            releases[index].disksize = old.disksize
            if (releases[index].checksum !== old.checksum) {
              releases[index].hasUpdate = true
            }
          } else {
            releases.push(old)
          }
        }
      })

      wineDownloaderInfoStore.delete('wine-releases')
    }

    wineDownloaderInfoStore.set('wine-releases', releases)
  } else {
    logInfo('Read local information ...', LogPrefix.WineDownloader)
    if (wineDownloaderInfoStore.has('wine-releases')) {
      releases.push(
        ...(wineDownloaderInfoStore.get('wine-releases') as WineVersionInfo[])
      )
    }
  }

  logInfo('wine versions updated', LogPrefix.WineDownloader)
  return releases
}

async function installWineVersion(
  release: WineVersionInfo,
  onProgress: (state: State, progress: ProgressInfo) => void,
  abortSignal: AbortSignal
) {
  let updatedInfo: WineVersionInfo

  if (!existsSync(`${heroicToolsPath}/wine`)) {
    mkdirSync(`${heroicToolsPath}/wine`, { recursive: true })
  }

  if (!existsSync(`${heroicToolsPath}/proton`)) {
    mkdirSync(`${heroicToolsPath}/proton`, { recursive: true })
  }

  logInfo(
    `Start installation of wine version ${release.version}`,
    LogPrefix.WineDownloader
  )

  const installDir = release?.type?.includes('Wine')
    ? `${heroicToolsPath}/wine`
    : `${heroicToolsPath}/proton`

  const result = await installVersion({
    versionInfo: release as VersionInfo,
    installDir,
    onProgress: onProgress,
    abortSignal: abortSignal
  })
    .then((response) => {
      updatedInfo = {
        ...response.versionInfo,
        installDir: response.installDir,
        isInstalled: true,
        hasUpdate: false,
        type: release.type
      }
    })
    .catch((error: Error) => {
      if (error.name.includes('AbortError')) {
        logWarning(`${error.message}`, LogPrefix.WineDownloader)
        return 'abort'
      }
      logError(`${error.message}`, LogPrefix.WineDownloader)
      return 'error'
    })

  if (result === 'abort' || result === 'error') {
    return result
  }

  // Update stored information
  if (wineDownloaderInfoStore.has('wine-releases')) {
    const releases = wineDownloaderInfoStore.get(
      'wine-releases'
    ) as WineVersionInfo[]

    const index = releases.findIndex((storedRelease) => {
      return release?.version === storedRelease?.version
    })

    if (index === -1) {
      logError(
        `Can't find ${release.version} in electron-store -> wine-downloader-info.json!`,
        LogPrefix.WineDownloader
      )
      return 'error'
    }

    releases[index] = updatedInfo

    wineDownloaderInfoStore.set('wine-releases', releases)
  } else {
    logError(
      `Couldn't find a tools entry in electron-store -> wine-downloader-info.json. Tool ${release.version} couldn't be installed!`,
      LogPrefix.WineDownloader
    )
    return 'error'
  }

  logInfo(
    `Finished installation of wine version ${release.version}`,
    LogPrefix.WineDownloader
  )
  return 'success'
}

async function removeWineVersion(release: WineVersionInfo): Promise<boolean> {
  // remove folder if exist
  if (existsSync(release.installDir)) {
    try {
      rmSync(release.installDir, { recursive: true })
    } catch (error) {
      logError(`${error}`, LogPrefix.WineDownloader)
      logWarning(
        `Couldn't remove folder ${release.installDir}! Still mark wine version ${release.version} as not installed!`,
        LogPrefix.WineDownloader
      )
    }
  }

  // update tool information
  if (wineDownloaderInfoStore.has('wine-releases')) {
    const releases = wineDownloaderInfoStore.get(
      'wine-releases'
    ) as WineVersionInfo[]

    const index = releases.findIndex((storedRelease) => {
      return release.version === storedRelease.version
    })

    if (index === -1) {
      logError(
        `Can't find ${release.version} in electron-store -> wine-downloader-info.json!`,
        LogPrefix.WineDownloader
      )
      return false
    }

    releases[index].isInstalled = false
    releases[index].installDir = ''
    releases[index].disksize = 0
    releases[index].hasUpdate = false

    wineDownloaderInfoStore.set('wine-releases', releases)
  } else {
    logError(
      `Couldn't find a wine-releases entry in electron-store -> wine-downloader-info.json. Release ${release.version} couldn't be removed!`,
      LogPrefix.WineDownloader
    )
    return false
  }

  logInfo(
    `Removed wine version ${release.version} succesfully.`,
    LogPrefix.WineDownloader
  )
  return true
}

export { updateWineVersionInfos, installWineVersion, removeWineVersion }
