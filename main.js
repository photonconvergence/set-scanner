'use strict'
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = true; // Disable security warning on the console

var SerialPort = require ( 'serialport' );

const FREQ_VENDOR_BANDS   = require ( 'require-all' )(__dirname +'/frequency_data/bands'  );
const FREQ_VENDOR_PRESETS = require ( 'require-all' )(__dirname +'/frequency_data/presets');
const COUNTRIES           = require ( './country_codes');

const {ipcMain}                      = require ( 'electron'               );
const {app, BrowserWindow, Menu}     = require ( 'electron'               );
const electronLocalshortcut          = require ( 'electron-localshortcut' );
const { productName, name, author, version } = require ( './package.json'         );
const { dialog }                     = require ( 'electron'               );

const ConfigStore = require ( 'configstore' );
const configStore = new ConfigStore ( name );

let MENU_BAND     = 0;
let MENU_CHANNELS = 1;
let MENU_COUNTRY  = 2;
let MENU_PORT     = 3;
let MENU_HELP     = 4;

let mainWindow;
let helpWindow;
let aboutWindow;

let country = configStore.get('country');

function createWindow () {
    mainWindow = new BrowserWindow({width: 1200, height: 700});
    mainWindow.loadFile('index.html');
    let wc = mainWindow.webContents;
    //wc.openDevTools();
    
    electronLocalshortcut.register ( mainWindow, 'Alt+CommandOrControl+Shift+I', () => {
        mainWindow.toggleDevTools();
    });

    electronLocalshortcut.register ( mainWindow, 'CommandOrControl+R', () => {
        mainWindow.reload();
    });

    mainWindow.setTitle ( productName + " V" + version );

/*        { label: 'Analyze', submenu: [
            { label: 'No channel analysis', type: 'radio', checked: true, click () { wc.send ( 'SET_VENDOR_4_ANALYSIS', { vendor: 'NON' } ); } },
            { label: 'Sennheiser channels', type: 'radio',                click () { wc.send ( 'SET_VENDOR_4_ANALYSIS', { vendor: 'SEN' } ); } },
            { label: 'Shure channels'     , type: 'radio',                click () { wc.send ( 'SET_VENDOR_4_ANALYSIS', { vendor: 'SHU' } ); } }
        ]}, */
        
    var portMenuJSON = { label: 'Port', submenu: [] };
    var helpMenuJSON = { label: 'Help', submenu: [
        { label: "Documentation", click () { openHelpWindow() ; } },
        { label: "About"        , click () { openAboutWindow(); } }
    ]};

    function addMenuEntryOrSubmenu ( menu_label, menu_data, menu_location ) {
        if ( !Array.isArray (menu_data) ) {
            menu_location.push ({
                "label": menu_label,
                click () { wc.send ( "CHANGE_BAND", {
                    start_freq : menu_data.start_freq,
                    stop_freq  : menu_data.stop_freq,
                    details    : menu_data.details,
                    band       : menu_data.band
                }); }
            });
            return;
        }

        let len = menu_location.push ({ "label": menu_label, "submenu": [] });

        menu_data.forEach ( (submenu_entry) => {
            if ( submenu_entry.hasOwnProperty ('submenu') ) {
                addMenuEntryOrSubmenu ( submenu_entry.label, submenu_entry.submenu, menu_location[len-1].submenu );
            } else {
                menu_location[len-1].submenu.push ({
                    "label": submenu_entry.label,
                    click () { wc.send ( "CHANGE_BAND", {
                        "start_freq" : submenu_entry.start_freq,
                        "stop_freq"  : submenu_entry.stop_freq,
                        "details"    : submenu_entry.details,
                        "band"       : submenu_entry.band
                    }); }
                });
            }
        });
    }

    var menuJSON = [];
    menuJSON.push ({ label: 'Band', submenu: [] });

    Object.entries ( FREQ_VENDOR_BANDS ).forEach ( vendorBandData => {
        let key   = vendorBandData[0];
        let value = vendorBandData[1];

        if ( Array.isArray ( value ) ) {
            menuJSON[MENU_BAND].submenu.push ({ type:'separator' });
            value.forEach ( (val) => {
                addMenuEntryOrSubmenu ( val.label, val, menuJSON[MENU_BAND].submenu );
            });
            menuJSON[MENU_BAND].submenu.push ({ type:'separator' });
        } else if ( value.hasOwnProperty ('submenu') )
            addMenuEntryOrSubmenu ( value.label, value.submenu, menuJSON[MENU_BAND].submenu );
        else
            addMenuEntryOrSubmenu ( value.label, value, menuJSON[MENU_BAND].submenu );
    });

    menuJSON.push ({ label: 'Chan. Presets', submenu: [] });

    Object.entries ( FREQ_VENDOR_PRESETS ).forEach ( vendorPreset => {
        let key        = vendorPreset[0].split("_");
        let preset     = vendorPreset[1];
        let vendor_idx = undefined;
        let band_idx   = undefined;
        let series_idx = undefined;

        vendor_idx = menuJSON[MENU_CHANNELS].submenu.findIndex ( ( elem ) => { return elem.label === key[0]; });

        if ( vendor_idx === -1 ) // Does this vendor already exists as a submenu?
            vendor_idx = menuJSON[MENU_CHANNELS].submenu.push ({ label: key[0], submenu: [] }) - 1;
        
        band_idx = menuJSON[MENU_CHANNELS].submenu[vendor_idx].submenu.findIndex ( ( elem ) => { return elem.label === key[1] + " - Band"; });
        
        if ( band_idx === -1 ) // Does this band already exist in this vendor submenu?
            band_idx = menuJSON[MENU_CHANNELS].submenu[vendor_idx].submenu.push ({ label: key[1] + " - Band", submenu: [] }) - 1;

        series_idx = menuJSON[MENU_CHANNELS].submenu[vendor_idx].submenu[band_idx].submenu.findIndex ( ( elem ) => { return elem.label === key[2]; });
        
        if ( series_idx ) // Does this series already exist in this band submenu?
            series_idx = menuJSON[MENU_CHANNELS].submenu[vendor_idx].submenu[band_idx].submenu.push ({ label: key[2], submenu: [] }) - 1;

        preset.forEach ( (bank, i) => {
            menuJSON[MENU_CHANNELS].submenu[vendor_idx].submenu[band_idx].submenu[series_idx].submenu.push ({
                label: "Bank " + (i+1),
                click () { wc.send ( "SET_CHAN_PRESET", { preset: vendorPreset[0] + "_" + (i+1) }); }
            });
        });
    });

    menuJSON.push ({ label: 'Country', submenu: [] });

    if ( !country ) {
        console.log ( "No country setting saved! Using default: 'DE'");
        country = "DE";
    }

    COUNTRIES.forEach ( ( c ) => {
        menuJSON[MENU_COUNTRY].submenu.push (
            {
                'label' : c.label,
                'code'  : c.code,
                'type'  : 'radio' ,
                'checked': country===c.code?true:false,
                click () { wc.send ( 'SET_COUNTRY', { country_code : c.code, country_label : c.label } ); }
            }
        );
    });

    ipcMain.on ( "SET_COUNTRY", (event, message) => {
        menuJSON[MENU_COUNTRY].submenu.forEach ( function ( elem ) {
            if ( elem.code === message.country_code ) {
                elem.checked = true;
                Menu.setApplicationMenu ( Menu.buildFromTemplate ( menuJSON ) );
            }
        });
    });

    menuJSON.push ( portMenuJSON );
    menuJSON.push ( helpMenuJSON );

    // Add serial ports to the menu
    SerialPort.list().then ( (ports, err) => {
        let portNameArr = [];

        if ( err ) {
            console.log ( err );
            return;
        }
        
        ports.forEach ( ( port ) => {
            portNameArr.push ( port.comName );
        });

        menuJSON[MENU_PORT].submenu[0] = { label: 'Auto', type: 'radio', click () { wc.send ( 'SET_PORT',  portNameArr ); } }

        portNameArr.forEach ( ( port ) => {
            menuJSON[MENU_PORT].submenu.push (
                {
                    'label' : port,
                    'type'  : 'radio' ,
                    click () { wc.send ( 'SET_PORT', { port : port } ); }
                }
            );
        });

        Menu.setApplicationMenu ( Menu.buildFromTemplate ( menuJSON ) );
    });

    function openHelpWindow () {
        helpWindow = new BrowserWindow({width: 800, height: 600});
        helpWindow.setMenu ( null );
        helpWindow.loadFile('help.html');

        electronLocalshortcut.register ( helpWindow, 'CommandOrControl+R', () => {
            helpWindow.reload();
        });

        electronLocalshortcut.register ( helpWindow, 'Alt+CommandOrControl+Shift+I', () => {
            helpWindow.toggleDevTools();
        });

        electronLocalshortcut.register ( helpWindow, 'Esc', () => {
            helpWindow.close();
        });

        helpWindow.setTitle ( "Documentation" );
    }

    function openAboutWindow () {
        aboutWindow = new BrowserWindow({width: 500, height: 180});
        aboutWindow.setMenu ( null );
        aboutWindow.loadFile('about.html');

        electronLocalshortcut.register ( aboutWindow, 'CommandOrControl+R', () => {
            aboutWindow.reload();
        });

        electronLocalshortcut.register ( aboutWindow, 'Alt+CommandOrControl+Shift+I', () => {
            aboutWindow.toggleDevTools();
        });

        electronLocalshortcut.register ( aboutWindow, 'Esc', () => {
            aboutWindow.close();
        });

        aboutWindow.setTitle ( "About" );
    }

    mainWindow.on('closed', function () {
        mainWindow = null;
    });
}

app.on ( 'ready', createWindow );

app.on ( 'window-all-closed', function () {
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if ( process.platform !== 'darwin' )
        app.quit();
});

app.on ( 'activate', function () {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if ( mainWindow === null )
        createWindow();
});