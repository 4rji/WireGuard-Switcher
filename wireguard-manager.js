const shell = require('shelljs');
const fs = require('fs');
const path = require('path');
const ip = require('ip');
const os = require('os');
const cron = require('node-cron');
const { execSync } = require('child_process');
const fetch = require('node-fetch');
const express = require('express');
const app = express();
const http = require('http').createServer(app);

// Configuration
const CONFIG_DIR = path.join(os.homedir(), 'wireguard');
const WG_BINARY = '/opt/homebrew/bin/wg';
const WG_QUICK = '/opt/homebrew/bin/wg-quick';
const SWITCH_INTERVAL = '*/3 * * * *'; // Every 3 minutes
const PORT = 3000;

// Store mapping between interfaces and config files
const interfaceConfigMap = new Map();

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Create public directory if it doesn't exist
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir);
}

// Create HTML file
const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>WireGuard Switcher</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f7;
            color: #1d1d1f;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            padding: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            margin: 0 0 20px 0;
            padding-bottom: 10px;
            border-bottom: 1px solid #e5e5e5;
            font-size: 24px;
            font-weight: 500;
        }
        .status-grid {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 15px;
            margin-bottom: 20px;
        }
        .status-label {
            color: #666;
            font-size: 14px;
        }
        .status-value {
            font-size: 14px;
            font-weight: 500;
            text-align: right;
        }
        .status-connected {
            color: #34c759;
            font-weight: 600;
        }
        .button {
            background-color: #0071e3;
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: background-color 0.2s;
            width: 100%;
            margin-top: 10px;
        }
        .button:hover {
            background-color: #0077ed;
        }
        .button.disconnect {
            background-color: #ff3b30;
        }
        .button.disconnect:hover {
            background-color: #ff453a;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>WireGuard Switcher</h1>
        <div class="status-grid">
            <div class="status-label">Status:</div>
            <div class="status-value status-connected" id="status">Disconnected</div>
            
            <div class="status-label">Current Config:</div>
            <div class="status-value" id="currentConfig">-</div>
            
            <div class="status-label">Local IP:</div>
            <div class="status-value" id="localIp">-</div>
            
            <div class="status-label">Public IP:</div>
            <div class="status-value" id="publicIp">-</div>

            <div class="status-label">City:</div>
            <div class="status-value" id="city">-</div>

            <div class="status-label">Country:</div>
            <div class="status-value" id="country">-</div>
        </div>
        <button class="button disconnect" id="disconnectBtn" style="display: none;">Disconnect</button>
    </div>
    <script>
        function updateStatus() {
            fetch('/status')
                .then(response => response.json())
                .then(data => {
                    document.getElementById('status').textContent = data.status;
                    document.getElementById('currentConfig').textContent = data.currentConfig;
                    document.getElementById('localIp').textContent = data.localIp;
                    document.getElementById('publicIp').textContent = data.publicIp;
                    document.getElementById('city').textContent = data.city;
                    document.getElementById('country').textContent = data.country;
                    
                    const disconnectBtn = document.getElementById('disconnectBtn');
                    if (data.status === 'Connected') {
                        disconnectBtn.style.display = 'block';
                    } else {
                        disconnectBtn.style.display = 'none';
                    }
                });
        }

        document.getElementById('disconnectBtn').addEventListener('click', () => {
            fetch('/disconnect', { method: 'POST' })
                .then(() => updateStatus());
        });

        // Update status every 5 seconds
        updateStatus();
        setInterval(updateStatus, 5000);
    </script>
</body>
</html>
`;

fs.writeFileSync(path.join(publicDir, 'index.html'), htmlContent);

// API endpoints
app.get('/status', async (req, res) => {
    try {
        const info = await getConnectionInfo();
        res.json(info);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/disconnect', async (req, res) => {
    try {
        // Get all active interfaces
        const activePeers = (await execWithSudo(`${WG_BINARY} show interfaces`)).stdout.trim();
        if (activePeers) {
            // Split interfaces and handle each one separately
            const interfaces = activePeers.split(/\s+/);
            
            // Try disconnecting using config files for all active interfaces
            for (const iface of interfaces) {
                console.log(`Disconnecting interface: ${iface}`);
                try {
                    // Check if we have the mapping for this interface
                    if (interfaceConfigMap.has(iface)) {
                        const mappedConfigFile = interfaceConfigMap.get(iface);
                        console.log(`Using mapped config file: ${mappedConfigFile}`);
                        await execWithSudo(`${WG_QUICK} down "${mappedConfigFile}"`);
                        // Remove the mapping after successful disconnect
                        interfaceConfigMap.delete(iface);
                        continue;
                    }
                    
                    // If no mapping found, try to find the config file for this interface
                    const possibleConfigFiles = [
                        path.join(CONFIG_DIR, `${iface}.conf`),
                        `/opt/homebrew/etc/wireguard/${iface}.conf`
                    ];
                    
                    let disconnected = false;
                    for (const configFile of possibleConfigFiles) {
                        if (fs.existsSync(configFile)) {
                            console.log(`Disconnecting using config file: ${configFile}`);
                            try {
                                await execWithSudo(`${WG_QUICK} down "${configFile}"`);
                                disconnected = true;
                                break;
                            } catch (err) {
                                console.error(`Error disconnecting with config file ${configFile}:`, err.message);
                            }
                        }
                    }
                    
                    if (!disconnected) {
                        console.log(`No config file found for ${iface}, using direct interface name as last resort`);
                        try {
                            await execWithSudo(`${WG_QUICK} down ${iface}`);
                        } catch (err) {
                            console.error(`Error disconnecting interface ${iface}:`, err.message);
                        }
                    }
                } catch (error) {
                    console.error(`Error disconnecting ${iface}:`, error.message);
                }
            }
            
            // Verify all interfaces are down
            const remainingInterfaces = (await execWithSudo(`${WG_BINARY} show interfaces`)).stdout.trim();
            if (remainingInterfaces) {
                console.log('Some interfaces are still active after disconnect attempts:', remainingInterfaces);
                // Try one more time with direct interface names
                for (const iface of remainingInterfaces.split(/\s+/)) {
                    console.log(`Forcefully disconnecting interface: ${iface}`);
                    try {
                        await execWithSudo(`${WG_QUICK} down ${iface}`);
                    } catch (err) {
                        console.error(`Error forcefully disconnecting ${iface}:`, err.message);
                    }
                }
            }
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start the server
http.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

// Configure shell
shell.config.execPath = process.env.PATH.split(':').find(p => fs.existsSync(path.join(p, 'node'))) || '/opt/homebrew/bin/node';
shell.config.silent = false; // Set to false to see command output

// Ensure config directory exists
if (!fs.existsSync(CONFIG_DIR)) {
    console.log('Creating wireguard config directory:', CONFIG_DIR);
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// Function to execute command with sudo
async function execWithSudo(command) {
    return new Promise((resolve, reject) => {
        console.log('Executing command:', command);
        try {
            // First try with sudo -n (non-interactive)
            const result = execSync(`sudo -n ${command}`, { encoding: 'utf8', stdio: 'pipe' });
            resolve({ stdout: result, stderr: '', code: 0 });
        } catch (error) {
            console.log('Retrying command with regular sudo');
            try {
                // If sudo -n fails, try with regular sudo
                const result = execSync(`sudo ${command}`, { encoding: 'utf8', stdio: 'pipe' });
                resolve({ stdout: result, stderr: '', code: 0 });
            } catch (sudoError) {
                console.error('Error executing sudo command:', sudoError.message);
                reject(sudoError);
            }
        }
    });
}

// Function to check if WireGuard is installed
function checkWireGuardInstallation() {
    if (!fs.existsSync(WG_BINARY) || !fs.existsSync(WG_QUICK)) {
        throw new Error('WireGuard is not installed. Please install it using: brew install wireguard-tools');
    }
}

// Function to get all .conf files from the config directory
function getConfigFiles() {
    try {
        console.log('Reading config directory:', CONFIG_DIR);
        checkWireGuardInstallation();
        const files = fs.readdirSync(CONFIG_DIR);
        const confFiles = files.filter(file => file.endsWith('.conf'));
        console.log('Found config files:', confFiles);
        return confFiles;
    } catch (error) {
        console.error('Error reading config directory:', error);
        return [];
    }
}

// Function to get IP location information
async function getIpLocation() {
    const services = [
        'https://ipinfo.io/json',
        'https://api.myip.com',
        'https://ifconfig.me/all.json'
    ];

    for (const url of services) {
        try {
            const response = await fetch(url);
            const data = await response.json();
            
            if (url === 'https://ipinfo.io/json') {
                return {
                    ip: data.ip,
                    city: data.city,
                    region: data.region,
                    country: data.country,
                    postal: data.postal,
                    display: `${data.ip}\n${data.city}\n${data.region}\n${data.country}`
                };
            } else if (url === 'https://api.myip.com') {
                return {
                    ip: data.ip,
                    country: data.country,
                    display: `${data.ip}\n${data.country}`
                };
            } else if (url === 'https://ifconfig.me/all.json') {
                return {
                    ip: data.ip_addr,
                    country: data.country,
                    display: `${data.ip_addr}\n${data.country}`
                };
            }
        } catch (error) {
            console.log(`Failed to get IP info from ${url}:`, error.message);
            continue;
        }
    }
    return null;
}

// Function to get connection information
async function getConnectionInfo() {
    console.log('Getting connection information...');
    try {
        checkWireGuardInstallation();
        const result = await execWithSudo(`${WG_BINARY} show interfaces`);
        const currentConfig = result.stdout.trim();
        const localIp = ip.address();
        
        let locationInfo = null;
        if (currentConfig) {
            try {
                // Intentar obtener la información directamente de ipinfo.io
                const response = await fetch('https://ipinfo.io/json');
                const data = await response.json();
                locationInfo = {
                    ip: data.ip,
                    city: data.city || 'Unknown',
                    region: data.region || '',
                    country: data.country || 'Unknown',
                    postal: data.postal || '',
                    display: `${data.ip}\n${data.city || 'Unknown'}, ${data.country || 'Unknown'}`
                };
                console.log('Location info:', locationInfo);
            } catch (error) {
                console.error('Error getting IP location:', error);
                // Si falla ipinfo.io, intentar con los otros servicios
                try {
                    locationInfo = await getIpLocation();
                } catch (backupError) {
                    console.error('Error getting backup IP location:', backupError);
                }
            }
        }

        const info = {
            currentConfig: currentConfig || 'Not connected',
            localIp,
            publicIp: locationInfo?.ip || 'Not connected',
            city: locationInfo?.city || 'Unknown',
            country: locationInfo?.country || 'Unknown',
            location: locationInfo ? {
                city: locationInfo.city,
                region: locationInfo.region,
                country: locationInfo.country,
                postal: locationInfo.postal,
                display: locationInfo.display
            } : null,
            status: currentConfig ? 'Connected' : 'Disconnected',
            timestamp: new Date().toISOString()
        };
        
        console.log('Connection info:', info);
        return info;
    } catch (error) {
        console.error('Error in getConnectionInfo:', error);
        return {
            currentConfig: 'Error',
            localIp: ip.address(),
            publicIp: 'Error',
            city: 'Error',
            country: 'Error',
            location: null,
            status: 'Error: ' + error.message,
            timestamp: new Date().toISOString()
        };
    }
}

// Function to switch to a new configuration
async function switchConfig(configFile) {
    console.log('Switching to config:', configFile);
    try {
        checkWireGuardInstallation();
        const configPath = path.isAbsolute(configFile) ? configFile : path.join(CONFIG_DIR, configFile);

        // Check if config file exists
        if (!fs.existsSync(configPath)) {
            throw new Error(`Configuration file not found: ${configPath}`);
        }

        // Check file permissions
        const stats = fs.statSync(configPath);
        if ((stats.mode & 0o777) !== 0o600) {
            console.log('Fixing config file permissions...');
            await execWithSudo(`chmod 600 ${configPath}`);
        }

        // Disconnect all current interfaces using their config files
        try {
            // Get all active interfaces
            const activePeers = (await execWithSudo(`${WG_BINARY} show interfaces`)).stdout.trim();
            if (activePeers) {
                console.log('Found active interfaces:', activePeers);
                // Split interfaces string and handle each one separately
                const interfaces = activePeers.split(/\s+/);
                
                // Try disconnecting using config files for all active interfaces
                for (const iface of interfaces) {
                    console.log(`Disconnecting interface: ${iface}`);
                    try {
                        // Check if we have the mapping for this interface
                        if (interfaceConfigMap.has(iface)) {
                            const mappedConfigFile = interfaceConfigMap.get(iface);
                            console.log(`Using mapped config file: ${mappedConfigFile}`);
                            await execWithSudo(`${WG_QUICK} down "${mappedConfigFile}"`);
                            // Remove the mapping after successful disconnect
                            interfaceConfigMap.delete(iface);
                            continue;
                        }
                        
                        // If no mapping found, try to find the config file for this interface
                        const possibleConfigFiles = [
                            path.join(CONFIG_DIR, `${iface}.conf`),
                            `/opt/homebrew/etc/wireguard/${iface}.conf`
                        ];
                        
                        let disconnected = false;
                        for (const configFile of possibleConfigFiles) {
                            if (fs.existsSync(configFile)) {
                                console.log(`Disconnecting using config file: ${configFile}`);
                                try {
                                    await execWithSudo(`${WG_QUICK} down "${configFile}"`);
                                    disconnected = true;
                                    break;
                                } catch (err) {
                                    console.error(`Error disconnecting with config file ${configFile}:`, err.message);
                                }
                            }
                        }
                        
                        if (!disconnected) {
                            console.log(`No config file found for ${iface}, using direct interface name as last resort`);
                            try {
                                await execWithSudo(`${WG_QUICK} down ${iface}`);
                            } catch (err) {
                                console.error(`Error disconnecting interface ${iface}:`, err.message);
                            }
                        }
                    } catch (error) {
                        console.error(`Error disconnecting ${iface}:`, error.message);
                    }
                }

                // Verify all interfaces are down
                const remainingInterfaces = (await execWithSudo(`${WG_BINARY} show interfaces`)).stdout.trim();
                if (remainingInterfaces) {
                    console.log('Some interfaces are still active after disconnect attempts:', remainingInterfaces);
                    // Try one more time with direct interface names
                    for (const iface of remainingInterfaces.split(/\s+/)) {
                        console.log(`Forcefully disconnecting interface: ${iface}`);
                        try {
                            await execWithSudo(`${WG_QUICK} down ${iface}`);
                        } catch (err) {
                            console.error(`Error forcefully disconnecting ${iface}:`, err.message);
                        }
                    }
                }
            } else {
                console.log('No active interfaces found to disconnect');
            }
        } catch (error) {
            console.log('Error checking active interfaces:', error.message);
        }

        // Additional wait to ensure all interfaces are fully down
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Double-check no interfaces are still active
        try {
            const finalCheck = (await execWithSudo(`${WG_BINARY} show interfaces`)).stdout.trim();
            if (finalCheck) {
                console.log('WARNING: Some interfaces are still active before connecting:', finalCheck);
            }
        } catch (error) {
            console.log('Error in final interface check:', error.message);
        }

        // Connect to the selected configuration
        console.log('Connecting to new configuration:', configPath);
        try {
            const result = await execWithSudo(`${WG_QUICK} up "${configPath}"`);
            console.log('Connection result:', result);
            
            if (result.code === 0) {
                console.log(`Successfully switched to ${configFile}`);
                
                // Get the interface name created by this config file and store the mapping
                try {
                    const interfaces = (await execWithSudo(`${WG_BINARY} show interfaces`)).stdout.trim();
                    if (interfaces) {
                        const interfaceList = interfaces.split(/\s+/);
                        for (const iface of interfaceList) {
                            // Store the mapping between interface and config file
                            interfaceConfigMap.set(iface, configPath);
                            console.log(`Mapped interface ${iface} to config ${configPath}`);
                        }
                    }
                } catch (error) {
                    console.error('Error storing interface mapping:', error.message);
                }
                
                return true;
            } else {
                throw new Error(result.stderr || 'Unknown error connecting to WireGuard');
            }
        } catch (error) {
            console.error(`Failed to switch to ${configFile}:`, error.message);
            throw error;
        }
    } catch (error) {
        console.error('Error switching configuration:', error);
        throw error;
    }
}

// Start automatic switching
let cronJob = null;

function startAutoSwitch() {
    if (cronJob) {
        cronJob.stop();
    }
    
    cronJob = cron.schedule(SWITCH_INTERVAL, async () => {
        try {
            const configFiles = getConfigFiles();
            if (configFiles.length > 0) {
                const result = await execWithSudo(`${WG_BINARY} show interfaces`);
                const currentConfig = result.stdout.trim();
                let nextConfigIndex = 0;
                
                if (currentConfig) {
                    const currentIndex = configFiles.findIndex(file => 
                        file.replace('.conf', '') === currentConfig
                    );
                    nextConfigIndex = (currentIndex + 1) % configFiles.length;
                }
                
                await switchConfig(configFiles[nextConfigIndex]);
            }
        } catch (error) {
            console.error('Error in auto-switch:', error);
        }
    });
}

// Start auto-switching when module is loaded
startAutoSwitch();

module.exports = {
    getConfigFiles,
    switchConfig,
    getConnectionInfo,
    startAutoSwitch
}; 