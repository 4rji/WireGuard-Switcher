const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const { getConfigFiles, switchConfig, getConnectionInfo } = require('./wireguard-manager');
const { execSync, exec } = require('child_process');
const fs = require('fs');

// Set the correct Node.js path
try {
    process.env.PATH = `/opt/homebrew/bin:${process.env.PATH}`;
    app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
    
    // Try to get Node.js path automatically, fallback to default if fails
    let nodePath;
    try {
        nodePath = execSync('which node').toString().trim();
    } catch (error) {
        nodePath = '/opt/homebrew/bin/node';
    }
    app.setPath('exe', nodePath);
} catch (error) {
    console.error('Error setting Node.js path:', error);
}

let mainWindow;
let tray;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 400,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            webSecurity: true
        },
        frame: true,
        resizable: true,
        show: false
    });

    // Set CSP header
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': ["default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"]
            }
        });
    });

    // Load the index.html file
    mainWindow.loadFile('index.html')
        .then(() => {
            console.log('Window loaded successfully');
            mainWindow.show();
        })
        .catch(err => {
            console.error('Error loading index.html:', err);
        });

    // Log any console messages from the renderer process
    mainWindow.webContents.on('console-message', (event, level, message) => {
        console.log('Renderer Console:', message);
    });
    
    // Create tray icon with error handling
    try {
        const iconPath = path.join(__dirname, 'assets/icon.png');
        tray = new Tray(iconPath);
    } catch (error) {
        console.log('Could not load custom icon, using default icon');
        tray = new Tray(path.join(__dirname, 'node_modules/electron/dist/Electron.app/Contents/Resources/electron.icns'));
    }

    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show', click: () => mainWindow.show() },
        { type: 'separator' },
        { label: 'Quit', click: () => {
            app.isQuiting = true;
            app.quit();
        }}
    ]);
    tray.setToolTip('WireGuard Switcher');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => mainWindow.show());

    // Hide window when minimized
    mainWindow.on('minimize', (event) => {
        event.preventDefault();
        mainWindow.hide();
    });

    // Close window when clicking close button
    mainWindow.on('close', (event) => {
        if (!app.isQuiting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });
}

// Wait for app to be ready
app.whenReady().then(() => {
    createWindow();
    
    // Log when IPC events are received
    ipcMain.on('get-configs', async (event) => {
        console.log('Received get-configs request');
        try {
            const configs = getConfigFiles();
            console.log('Sending configs:', configs);
            event.reply('configs-list', configs);
        } catch (error) {
            console.error('Error getting configs:', error);
            event.reply('configs-list', []);
        }
    });

    ipcMain.on('switch-config', async (event, configFile) => {
        console.log('Received switch-config request:', configFile);
        try {
            await switchConfig(configFile);
            const info = await getConnectionInfo();
            console.log('Sending connection info:', info);
            event.reply('connection-info', info);
        } catch (error) {
            console.error('Error switching config:', error);
            event.reply('connection-info', {
                currentConfig: 'Error',
                localIp: 'Error',
                publicIp: 'Error',
                status: 'Error: ' + error.message
            });
        }
    });

    ipcMain.on('get-connection-info', async (event) => {
        console.log('Received get-connection-info request');
        try {
            const info = await getConnectionInfo();
            console.log('Sending connection info:', info);
            event.reply('connection-info', info);
        } catch (error) {
            console.error('Error getting connection info:', error);
            event.reply('connection-info', {
                currentConfig: 'Error',
                localIp: 'Error',
                publicIp: 'Error',
                status: 'Error: ' + error.message
            });
        }
    });

    // Handle disconnect request
    ipcMain.on('disconnect-wireguard', async (event) => {
        console.log('Received disconnect-wireguard request');
        try {
            // Get active interfaces
            const result = execSync('wg show interfaces').toString().trim();
            if (result) {
                const interfaces = result.split(/\s+/);
                console.log(`Disconnecting interfaces: ${interfaces.join(', ')}`);
                
                const homeDir = require('os').homedir();
                const CONFIG_DIR = path.join(homeDir, 'wireguard');
                
                // Disconnect each interface
                for (const iface of interfaces) {
                    try {
                        // Buscar archivos de configuración en diferentes ubicaciones
                        const possibleConfigFiles = [
                            path.join(CONFIG_DIR, `${iface}.conf`),
                            `/opt/homebrew/etc/wireguard/${iface}.conf`,
                            `/etc/wireguard/${iface}.conf`,
                            path.join(CONFIG_DIR, `${iface.replace('utun', 'wg')}.conf`),
                            path.join(CONFIG_DIR, `${iface}_wireguard.conf`)
                        ];
                        
                        let disconnected = false;
                        for (const configFile of possibleConfigFiles) {
                            if (fs.existsSync(configFile)) {
                                console.log(`Disconnecting using config file: ${configFile}`);
                                try {
                                    execSync(`sudo wg-quick down "${configFile}"`);
                                    console.log(`Successfully disconnected ${iface} using ${configFile}`);
                                    disconnected = true;
                                    break;
                                } catch (err) {
                                    console.error(`Error disconnecting with config file ${configFile}:`, err.message);
                                }
                            }
                        }
                        
                        // Si no se encontró el archivo de configuración, intentar directamente con el nombre de la interfaz
                        if (!disconnected) {
                            console.log(`No config file found for ${iface}, trying to disconnect interface directly`);
                            try {
                                // Intentar cargando todas las configuraciones para encontrar coincidencias
                                const configs = getConfigFiles();
                                for (const config of configs) {
                                    try {
                                        const fullPath = path.join(CONFIG_DIR, config);
                                        console.log(`Trying to disconnect with config: ${fullPath}`);
                                        execSync(`sudo wg-quick down "${fullPath}"`);
                                        console.log(`Successfully disconnected using ${fullPath}`);
                                        disconnected = true;
                                        break;
                                    } catch (configErr) {
                                        console.error(`Failed to disconnect with ${config}:`, configErr.message);
                                    }
                                }
                                
                                // Como último recurso, intentar directamente con el nombre de la interfaz
                                if (!disconnected) {
                                    console.log(`Trying direct interface disconnect for ${iface}`);
                                    execSync(`sudo wg-quick down ${iface}`);
                                    console.log(`Successfully disconnected ${iface} directly`);
                                }
                            } catch (err) {
                                console.error(`Error disconnecting interface ${iface}:`, err.message);
                            }
                        }
                    } catch (err) {
                        console.error(`Error processing interface ${iface}:`, err.message);
                    }
                }
            } else {
                console.log('No active WireGuard interfaces found');
            }
            
            // Update status
            const info = await getConnectionInfo();
            event.reply('connection-info', info);
        } catch (error) {
            console.error('Error disconnecting WireGuard:', error);
            event.reply('connection-info', {
                currentConfig: 'Not connected',
                localIp: 'Not connected',
                publicIp: 'Not connected',
                status: 'Disconnected'
            });
        }
    });

    // Handle location info request
    ipcMain.on('get-location-info', (event) => {
        exec('/Users/ozono/GitHub/bina/binarios/pggm', (error, stdout, stderr) => {
            if (error) {
                console.error(`Error executing script: ${error.message}`);
                event.reply('location-info', { error: error.message });
                return;
            }
            if (stderr) {
                console.error(`Script stderr: ${stderr}`);
                event.reply('location-info', { error: stderr });
                return;
            }

            // Parse the output to extract city and country
            const output = stdout.split('\n');
            const city = output.find(line => line.includes('City:'))?.split(':')[1]?.trim() || 'Unknown';
            const country = output.find(line => line.includes('Country:'))?.split(':')[1]?.trim() || 'Unknown';

            event.reply('location-info', { city, country });
        });
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});