const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const { startLocalServer, stopLocalServer } = require('./local-api.cjs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

let mainWindow = null;
let localServer = null;

function findFirstExistingPath(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function createDesktopLogger() {
  const candidates = [
    path.join(app.getPath('userData'), 'desktop-runtime.log'),
    path.join(path.dirname(process.execPath), 'desktop-runtime.log'),
  ];

  const logPath = candidates[0];
  return {
    logPath,
    write(message) {
      const line = `[${new Date().toISOString()}] ${message}\n`;
      try {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.appendFileSync(logPath, line, 'utf8');
      } catch {
        // Logging must never crash the app.
      }
    },
  };
}

const logger = createDesktopLogger();
logger.write('process-start');

function resolveDesktopPaths() {
  if (app.isPackaged) {
    const exeDir = path.dirname(process.execPath);
    const portableExecutableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    const portableExecutableFile = process.env.PORTABLE_EXECUTABLE_FILE;
    const portableExecutableFileDir = portableExecutableFile ? path.dirname(portableExecutableFile) : null;
    const resourceDirCandidates = [
      process.resourcesPath,
      path.join(exeDir, 'resources'),
      path.join(process.cwd(), 'resources'),
    ];
    const resourceDir = findFirstExistingPath(resourceDirCandidates);

    return {
      distDir: findFirstExistingPath([
        path.join(resourceDir, 'app-dist'),
        path.join(process.resourcesPath, 'app-dist'),
        path.join(exeDir, 'resources', 'app-dist'),
      ]),
      runtimeDir: findFirstExistingPath([
        path.join(resourceDir, 'python-runtime'),
        path.join(process.resourcesPath, 'python-runtime'),
        path.join(exeDir, 'resources', 'python-runtime'),
      ]),
      packagedServerDir: findFirstExistingPath([
        path.join(resourceDir, 'server'),
        path.join(process.resourcesPath, 'server'),
        path.join(exeDir, 'resources', 'server'),
      ]),
      solverDir: findFirstExistingPath([
        path.join(resourceDir, 'solvers'),
        path.join(process.resourcesPath, 'solvers'),
        path.join(exeDir, 'resources', 'solvers'),
      ]),
      projectRoot: resourceDir,
      envFileCandidates: [
        portableExecutableDir ? path.join(portableExecutableDir, '.env') : null,
        portableExecutableFileDir ? path.join(portableExecutableFileDir, '.env') : null,
        path.join(exeDir, '.env'),
        path.join(resourceDir, '.env'),
      ],
      mode: 'packaged',
    };
  }

  return {
    distDir: path.resolve(__dirname, '../dist'),
    runtimeDir: null,
    packagedServerDir: path.resolve(__dirname, '../server'),
    solverDir: path.resolve(__dirname, 'resources/solvers'),
    projectRoot: path.resolve(__dirname, '..'),
    envFileCandidates: [
      path.resolve(__dirname, '../.env'),
    ],
    mode: 'development',
  };
}

async function createMainWindow() {
  const paths = resolveDesktopPaths();
  logger.write(`startup mode=${paths.mode} distDir=${paths.distDir} runtimeDir=${paths.runtimeDir || ''} packagedServerDir=${paths.packagedServerDir || ''} solverDir=${paths.solverDir} projectRoot=${paths.projectRoot}`);
  logger.write('createMainWindow startLocalServer begin');
  localServer = await startLocalServer(paths, logger);
  logger.write(`createMainWindow startLocalServer ready url=${localServer.url}`);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  logger.write('browser-window created');

  mainWindow.once('ready-to-show', () => {
    logger.write('browser-window ready-to-show');
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    logger.write('browser-window closed');
    mainWindow = null;
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logger.write(`did-fail-load code=${errorCode} url=${validatedURL} description=${errorDescription}`);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    logger.write('did-finish-load');
  });

  logger.write(`loadURL begin ${localServer.url}`);
  await mainWindow.loadURL(localServer.url);
  logger.write('loadURL resolved');
}

app.whenReady().then(async () => {
  try {
    await createMainWindow();
  } catch (error) {
    logger.write(`startup-error ${error instanceof Error ? error.stack || error.message : String(error)}`);
    dialog.showErrorBox('FYP Scheduling System', error instanceof Error ? error.message : String(error));
    app.quit();
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  await stopLocalServer(localServer);
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  await stopLocalServer(localServer);
});

process.on('uncaughtException', (error) => {
  logger.write(`uncaughtException ${error.stack || error.message}`);
});

process.on('unhandledRejection', (reason) => {
  logger.write(`unhandledRejection ${reason instanceof Error ? reason.stack || reason.message : String(reason)}`);
});