let tempDirectory = process.env['RUNNER_TEMP'] || '';

import * as core from '@actions/core';
import * as io from '@actions/io';
import * as exec from '@actions/exec';
import * as tc from '@actions/tool-cache';
import * as fs from 'fs';
import * as path from 'path';
import * as semver from 'semver';
import * as httpm from 'typed-rest-client/HttpClient';

const IS_WINDOWS = process.platform === 'win32';

if (!tempDirectory) {
  let baseLocation;
  if (IS_WINDOWS) {
    // On windows use the USERPROFILE env variable
    baseLocation = process.env['USERPROFILE'] || 'C:\\';
  } else {
    if (process.platform === 'darwin') {
      baseLocation = '/Users';
    } else {
      baseLocation = '/home';
    }
  }
  tempDirectory = path.join(baseLocation, 'actions', 'temp');
}

export async function getHub(version: string): Promise<void> {
  core.debug('Downloading hub from Github releases');
  const downloadInfo = await getDownloadInfo(version);
  let toolPath = tc.find('hub', downloadInfo.version);
  if (toolPath) {
    core.debug(`Tool found in cache ${toolPath}`);
  } else {
    let compressedFileExtension = '';
    core.debug(
      `Tool not found in cache. Download tool from url: ${downloadInfo.url}`
    );
    let hubBin = await tc.downloadTool(downloadInfo.url);
    core.debug(`Downloaded file: ${hubBin}`);
    compressedFileExtension = IS_WINDOWS ? '.zip' : '.tgz';

    let tempDir: string = path.join(
      tempDirectory,
      'temp_' + Math.floor(Math.random() * 2000000000)
    );
    const hubDir = await unzipHubDownload(
      hubBin,
      compressedFileExtension,
      tempDir
    );
    core.debug(`hub extracted to ${hubDir}`);
    core.debug(`caching directory containing version ${downloadInfo.version}`);
    toolPath = await tc.cacheDir(hubDir, 'hub', downloadInfo.version);
  }
  core.debug(`adding hub to path: ${toolPath}`);
  if (IS_WINDOWS) {
    core.addPath(toolPath);
  } else {
    core.addPath(path.join(toolPath, 'bin'));
  }
}

function getFileEnding(file: string): string {
  let fileEnding = '';

  if (file.endsWith('.tgz')) {
    fileEnding = '.tgz';
  } else if (file.endsWith('.zip')) {
    fileEnding = '.zip';
  } else {
    throw new Error(`${file} has an unsupported file extension`);
  }

  return fileEnding;
}

async function extractFiles(
  file: string,
  fileEnding: string,
  destinationFolder: string
): Promise<void> {
  const stats = fs.statSync(file);
  if (!stats) {
    throw new Error(`Failed to extract ${file} - it doesn't exist`);
  } else if (stats.isDirectory()) {
    throw new Error(`Failed to extract ${file} - it is a directory`);
  }

  if ('.tgz' === fileEnding) {
    await tc.extractTar(file, destinationFolder);
  } else if ('.zip' === fileEnding) {
    await tc.extractZip(file, destinationFolder);
  } else {
    // fall through and use sevenZip
    await tc.extract7z(file, destinationFolder);
  }
}

async function unzipHubDownload(
  repoRoot: string,
  fileEnding: string,
  destinationFolder: string,
  extension?: string
): Promise<string> {
  // Create the destination folder if it doesn't exist
  core.debug(`unzip download ${repoRoot}`);
  await io.mkdirP(destinationFolder);

  const file = path.normalize(repoRoot);
  const stats = fs.statSync(file);
  if (stats.isFile()) {
    await extractFiles(file, fileEnding, destinationFolder);
    const hubDir = path.join(
      destinationFolder,
      fs.readdirSync(destinationFolder)[0]
    );
    return hubDir;
  } else {
    throw new Error(`file argument ${file} is not a file`);
  }
}

async function getDownloadInfo(version: string): Promise<DownloadInfo> {
  let platform = '';
  let fileExtension = IS_WINDOWS ? '.zip' : '.tgz';

  if (IS_WINDOWS) {
    platform = `windows`;
  } else {
    if (process.platform === 'darwin') {
      platform = `darwin`;
    } else {
      platform = `linux`;
    }
  }

  if (version) {
    core.debug(`download version = ${version}`);
    let validVersion = semver.valid(version);
    if (!validVersion) {
      throw new Error(
        `No valid download found for version ${version}. Check https://github.com/github/hub/releases for a list of valid releases`
      );
    }
    //specific version, get that version from releases
    return {
      url: `https://github.com/github/hub/releases/download/v${version}/hub-${platform}-amd64-${version}${fileExtension}`,
      version: version
    } as DownloadInfo;
  } else {
    //get latest release
    core.debug('Downloading latest release because no version selected');
    let http: httpm.HttpClient = new httpm.HttpClient('setup-hub');
    let releaseJson = await (await http.get(
      'https://api.github.com/repos/github/hub/releases/latest'
    )).readBody();
    let releasesInfo = JSON.parse(releaseJson);
    core.debug(`latest version = ${releasesInfo.tag_name}`);
    let latestVersion = releasesInfo.tag_name.substring(1);

    return {
      url: `https://github.com/github/hub/releases/latest/download/hub-${platform}-amd64-${latestVersion}${fileExtension}`,
      version: latestVersion
    } as DownloadInfo;
  }
}

export interface DownloadInfo {
  url: string;
  version: string;
}
