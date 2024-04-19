import fs, { InMemory, mkdirpSync, rootCred } from '../index';  // Use the in-memory filesystem module
import * as path from '../emulation/path';  // Use Node's path module to handle paths
import uuid from 'uuid';

import { readFileSync, existsSync, writeFileSync } from '../emulation/sync';

const WORKSPACES_DIRECTORY_PATH = '/var/workspaces';
const WORKSPACES_SELECTED_FILENAME = '.selected';
const WORKSPACES_NODE_NAME = 'workspace.json';

const GIT_DIRECTORY_PATH = '/gitdirs';
const REPOS_DIRECTORY_PATH = '/src/projects';
const REPOS_SELECTED_FILENAME = '.selected';

const TERMINAL_DIRECTORY_PATH = '/etc/terminal';
const TERMINAL_STDIN_FILENAME = '.stdin';
const TERMINAL_STDOUT_FILENAME = '.stdout';
const TERMINAL_DATA_FILENAME = '.data';
const TERMINAL_HISTORY_FILENAME = '.bash_history';
const TERMINAL_PROMPT_FILENAME = '.bash_prompt';



const PROCESSES_DIRECTORY_PATH = '/run';
const PROCESSES_ACTIVE_PROCESS_FILENAME = 'active.apid';
const PROCESSES_FOLLOWER_EXTENSIONS = '.fpid';

const initializeFileSystem = function initializeFileSystem() {
  if (existsSync('/etc')) return;
  // fs.getRootFS().rootFs.empty();
  // @ts-ignore
  mkdirpSync('/etc', 0, rootCred, fs);
  // @ts-ignore
  mkdirpSync('/home', 0, rootCred, fs);
  // @ts-ignore
  mkdirpSync(WORKSPACES_DIRECTORY_PATH, 0, rootCred, fs);
  // @ts-ignore
  mkdirpSync(TERMINAL_DIRECTORY_PATH, 0, rootCred, fs);
  // @ts-ignore
  mkdirpSync(REPOS_DIRECTORY_PATH, 0, rootCred, fs);
  // @ts-ignore
  mkdirpSync(GIT_DIRECTORY_PATH, 0, rootCred, fs);
  // @ts-ignore
  mkdirpSync(PROCESSES_DIRECTORY_PATH, 0, rootCred, fs);
};

export function initialize() {
  initializeFileSystem();
  initializeRootProcess();
}


// used for cloning a tab node
const getPidFromPid = ({ pid }) => {
  if (pid === PROCESSES_ACTIVE_PROCESS_FILENAME) {
    return pid;
  }
  if (pid.endsWith(PROCESSES_FOLLOWER_EXTENSIONS)) {
    return pid;
  }
  return undefined;
};

let c = 1; // cant use this style in prod unless we serialized this number in fs
const getShortId =
  process.env.NODE_ENV === 'test'
    ? () => {
      return c++ + '';
    }
    : () => {
      const [a, b, c] = uuid().split('-');
      return a.slice(0, 3) + b.slice(1, 2) + c.slice(2, 4);
    };
const nameRegExp = /^([.a-zA-Z]+[\w]*)([0-9]+)$/;
const actualBasename = n => path.basename(n, path.extname(n));

const getBaseNumExtTripletPlusOne = n => {
  const base = actualBasename(n);
  const ext = path.extname(n);
  const match = base.match(nameRegExp);
  if (match) {
    return [match[1], Number(match[2]) + 1, ext].join('');
  }
  return [base, 1, ext].join('');
};

const getUniqueName = (names, name) => {
  if (!names.includes(name)) return name;
  return getUniqueName(names, getBaseNumExtTripletPlusOne(name));
};

function toCamelCase(str) {
  return str
    .replace(/(?:^\w|[A-Z]|\b\w|\s+)/g, function (match, index) {
      if (+match === 0) return ""; // or if (/\s+/.test(match)) for white spaces
      return index === 0 ? match.toLowerCase() : match.toUpperCase();
    });
}


const findNameFromNameOrType = ({ names, name, type, ext }) => {
  if (!name && !type) {
    throw new Error('bad type');
  }
  if (!name) {
    name = getBaseNumExtTripletPlusOne(ext ? toCamelCase(type) + ext : toCamelCase(type));
  }
  if (ext && path.extname(name).length < 2) {
    name = name + ext;
  }
  return getUniqueName(names, name);
};

const getAvailableName = ({
  root,
  name,
  type,
  ext
}) => {
  const children = fs.readdirSync(root);
  return findNameFromNameOrType({ names: children, name, type, ext });
};

const getUniqLocalId = (root) => {
  // @ts-ignore
  return getAvailableName({ root, name: getShortId() });
};

const getPid = ({ pid, title, spawn, follow, data, cwd }) => {
  const pidFromPid = data && data.pid && getPidFromPid({ pid: data.pid });
  if (pidFromPid) return pidFromPid;
  if (!spawn) return PROCESSES_ACTIVE_PROCESS_FILENAME;
  if (follow) return `${path.basename(follow)}${PROCESSES_FOLLOWER_EXTENSIONS}`;
  return title
    ? createProcess({
      title, // TODO slugify title for pid
      pid: pid ? pid : `${title}-${getUniqLocalId(PROCESSES_DIRECTORY_PATH)}`,
      cwd: cwd ?? path
    })
    // @ts-ignore
    : createProcess({ cwd: path, pid: pid ? pid : undefined });
};


export function initializeRootProcess() {
  const rootProcessPath = path.join(PROCESSES_DIRECTORY_PATH, 'root');
  if (!existsSync(rootProcessPath)) {
    createProcess({ title: 'root', pid: 'root', cwd: '/' });
    setActiveProcess('root');
  }
}

// @ts-ignore
export function createProcess({ title, pid, cwd = '/' } = {}) {
  const processPath = getProcessPath(pid);
  // @ts-ignore
  mkdirpSync(path.dirname(processPath), 0, rootCred, fs);
  writeState(processPath, { pid, cwd, title });
  return pid;
}

export function getProcessPath(pid) {
  return path.join(PROCESSES_DIRECTORY_PATH, pid);
}

export function getActiveProcessPath() {
  return path.join(PROCESSES_DIRECTORY_PATH, PROCESSES_ACTIVE_PROCESS_FILENAME);
}

export function writeState(processPath, state) {
  writeFileSync(processPath, JSON.stringify(state));
}

// Helper functions based on previous setup
export function getActiveProcess() {
  const pid = getActiveProcessId(); // Assume this retrieves the current active process ID
  return readState(getProcessPath(pid)); // Retrieve the process state
}

export function readState(processPath) {
  const data = readFileSync(processPath, 'utf8'); // Read the state from the filesystem
  return JSON.parse(data); // Parse the JSON data into an object
}

export function getActiveProcessId() {
  const activeProcessPath = getActiveProcessPath();
  return readFileSync(activeProcessPath, 'utf8').trim(); // Read and return the active process ID
}


export const setActiveProcess = (pid: string) => {
  if (pid === PROCESSES_ACTIVE_PROCESS_FILENAME) return [];
  if (pid.endsWith(PROCESSES_FOLLOWER_EXTENSIONS))
    pid = pid.split(PROCESSES_FOLLOWER_EXTENSIONS)[0];
  const activePidPath = getActiveProcessPath();
  fs.writeFileSync(activePidPath, pid);
  return [activePidPath];
};

const isPinnedProcess = pid =>
  pid === PROCESSES_ACTIVE_PROCESS_FILENAME ||
  pid.endsWith(PROCESSES_FOLLOWER_EXTENSIONS);

const getPinnedProcess = pid => {
  return pid === PROCESSES_ACTIVE_PROCESS_FILENAME
    ? getActiveProcess()
    : readState(
      path.join(
        PROCESSES_DIRECTORY_PATH,
        pid.split(PROCESSES_FOLLOWER_EXTENSIONS)[0]
      )
      // ,
      // {
      //   cwd: '/'
      // }
    );
};


export function kill(...args) {
  // TODO cleanup the terminal stdout/stdin/history paths...
  for (let pid of args) {
    if (isPinnedProcess(pid)) continue;
    const processPath = getProcessPath(pid);
    if (this.fs.existsSync(processPath)) {
      this.fs.unlinkSync(processPath);
    }
  }
}

export const detach = () => {
  return setActiveProcess('root');
};

export const spawn = () => {
  // @ts-ignore
  return getPid({})
};
