const cron = require('node-cron');
const shell = require('shelljs');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG_DIR = '/etc/wireguard'; // Default WireGuard config directory on macOS
const SWITCH_INTERVAL = '*/3 * * * *'; // Every 3 minutes

// Function to get all .conf files from the config directory
function getConfigFiles() {
    try {
        const files = fs.readdirSync(CONFIG_DIR);
        return files.filter(file => file.endsWith('.conf'));
    } catch (error) {
        console.error('Error reading config directory:', error);
        return [];
    }
}

// Function to switch to a new configuration
function switchConfig(configFile) {
    const configPath = path.join(CONFIG_DIR, configFile);
    const interfaceName = configFile.replace('.conf', '');

    // Disconnect current connection if any
    shell.exec('wg-quick down ' + interfaceName, { silent: true });

    // Connect to new configuration
    const result = shell.exec('wg-quick up ' + configPath);
    
    if (result.code === 0) {
        console.log(`Successfully switched to ${configFile}`);
    } else {
        console.error(`Failed to switch to ${configFile}:`, result.stderr);
    }
}

// Main function to handle configuration switching
function main() {
    const configFiles = getConfigFiles();
    
    if (configFiles.length === 0) {
        console.error('No WireGuard configuration files found in', CONFIG_DIR);
        return;
    }

    // Get current active configuration
    const currentConfig = shell.exec('wg show interfaces', { silent: true }).stdout.trim();
    
    // Find next configuration to switch to
    let nextConfigIndex = 0;
    if (currentConfig) {
        const currentIndex = configFiles.findIndex(file => 
            file.replace('.conf', '') === currentConfig
        );
        nextConfigIndex = (currentIndex + 1) % configFiles.length;
    }

    // Switch to next configuration
    switchConfig(configFiles[nextConfigIndex]);
}

// Schedule the task to run every 3 minutes
console.log('Starting WireGuard configuration switcher...');
cron.schedule(SWITCH_INTERVAL, () => {
    console.log('Switching WireGuard configuration...');
    main();
});

// Run immediately on startup
main(); 