'use strict'
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = true; // Disable security warning on the console

var { SerialPort } = require ( 'serialport' );
const fs           = require ('fs');

const FREQ_VENDOR_BANDS   = require ( 'require-all' )(__dirname +'/frequency_data/vendor_bands'  );
const FREQ_VENDOR_PRESETS = require ( 'require-all' )(__dirname +'/frequency_data/presets');
const COUNTRIES           = require ( './country_codes');

const {ipcMain}                      = require ( 'electron'               );
const {app, BrowserWindow, Menu}     = require ( 'electron'               );
const electronLocalshortcut          = require ( 'electron-localshortcut' );
const { productName, name, author, version } = require ( './package.json' );
const { dialog }                     = require ( 'electron'               );

app.commandLine.appendSwitch('disable-gpu');
require('@electron/remote/main').initialize()

require ( './logger.js' );

// See the following discussions for next setting
// https://stackoverflow.com/questions/60106922/electron-non-context-aware-native-module-in-renderer
//https://github.com/electron/electron/issues/18397#issuecomment-583221969
app.allowRendererProcessReuse = false

const ConfigStore = require ( 'configstore' );
const configStore = new ConfigStore ( name );

let MENU_BAND     = 0;
let MENU_CHANNELS = 1;
let MENU_COUNTRY  = 2;
let MENU_PORT     = 3;
let MENU_SCAN_DEVICE = 4;
let MENU_TOOLS    = 5;
let MENU_TEST     = 6;
let MENU_HELP     = 7;

if ( process.platform === 'darwin') {
    MENU_BAND     = 1;
    MENU_CHANNELS = 2;
    MENU_COUNTRY  = 3;
    MENU_PORT     = 4;
    MENU_SCAN_DEVICE = 5;
    MENU_TOOLS    = 6;
    MENU_TEST     = 7;
    MENU_HELP     = 8;
}

let mainWindow;
let helpWindow;
let aboutWindow;

let globalPorts = []

let country_code = configStore.get('country_code');

if ( !country_code ) {
    log.info ( "No country setting saved! Using default: 'US'");
    country_code = "US";
}

const gotLock = app.requestSingleInstanceLock()
    
if ( !gotLock ) {
    app.quit()
} else { // This applies to the first instance of the application which has got the lock
    app.on ( 'second-instance', (event, commandLine, workingDirectory ) => {
        // Someone tried to run a second instance, we should focus our window.
        if ( mainWindow ) {
            if ( mainWindow.isMinimized() ) {
                mainWindow.restore()
            }

            mainWindow.focus()
        }
    })
}

function createWindow () {
    mainWindow = new BrowserWindow ({
        width: 1200,
        height: 700,
        webPreferences: {
            nodeIntegration: true,
            enableRemoteModule: true,
            contextIsolation: false
        }
    });
    mainWindow.loadFile('index.html');
    let wc = mainWindow.webContents;
    require("@electron/remote/main").enable(wc)
//wc.openDevTools();
    
    electronLocalshortcut.register ( mainWindow, 'F12', () => {
        mainWindow.toggleDevTools();
    });

    electronLocalshortcut.register ( mainWindow, 'CommandOrControl+R', () => {
        app.relaunch ()
        app.exit (0)
    });

    mainWindow.setTitle ( productName + " V" + version );
    var menuJSON = [];

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
            } else if ( submenu_entry.hasOwnProperty ('type') && submenu_entry.type === 'separator' ) {
                menu_location[len-1].submenu.push ({type: "separator"});
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

    if ( process.platform === 'darwin' )
        menuJSON.push ({ label: 'App Menu', submenu: [{ role: 'quit'}] })

    // Add bands
    menuJSON.push ({ label: 'Band', submenu: [] });
    menuJSON[MENU_BAND].submenu.push ({ label : 'Manual input             F', click () { wc.send ( 'SHOW_MANUAL_BAND_SETTINGS') }});
    menuJSON[MENU_BAND].submenu.push ({ label: 'Save to hotkey', submenu: [
        { label: "1", click () { wc.send ( 'SAVE_TO_HOTKEY', { hotkey : '1'}) }},
        { label: "2", click () { wc.send ( 'SAVE_TO_HOTKEY', { hotkey : '2'}) }},
        { label: "3", click () { wc.send ( 'SAVE_TO_HOTKEY', { hotkey : '3'}) }},
        { label: "4", click () { wc.send ( 'SAVE_TO_HOTKEY', { hotkey : '4'}) }},
        { label: "5", click () { wc.send ( 'SAVE_TO_HOTKEY', { hotkey : '5'}) }},
        { label: "6", click () { wc.send ( 'SAVE_TO_HOTKEY', { hotkey : '6'}) }},
        { label: "7", click () { wc.send ( 'SAVE_TO_HOTKEY', { hotkey : '7'}) }},
        { label: "8", click () { wc.send ( 'SAVE_TO_HOTKEY', { hotkey : '8'}) }},
        { label: "9", click () { wc.send ( 'SAVE_TO_HOTKEY', { hotkey : '9'}) }}
    ]})
    menuJSON[MENU_BAND].submenu.push ({ type:'separator' });
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
    if ( country_code && fs.existsSync ( __dirname + '/frequency_data/country_bands/' + country_code ) ) {
        const COUNTRY_BANDS = require ( 'require-all' )(__dirname +'/frequency_data/country_bands/' + country_code );
        menuJSON[MENU_BAND].submenu.push ({ type:'separator' });

        Object.entries ( COUNTRY_BANDS ).forEach ( countryBandData => {
            let key   = countryBandData[0];
            let value = countryBandData[1];
            addMenuEntryOrSubmenu ( value.label, value.hasOwnProperty('submenu')?value.submenu:value, menuJSON[MENU_BAND].submenu );
        });
    }

    // Add channel presets
    menuJSON.push ({ label: 'Chan. Presets', submenu: [] });
    Object.entries ( FREQ_VENDOR_PRESETS ).forEach ( vendorPreset => {
        let key        = vendorPreset[0];
        menuJSON[MENU_CHANNELS].submenu.push (
            {
                'label'  : key,
                 click () {wc.send ("SET_CHAN_PRESET", {preset:key}); }
            }
        );
        });

    // Add countries
    menuJSON.push ({ label: 'Country', submenu: [] });
    COUNTRIES.forEach ( c => {
        if ( fs.existsSync ( __dirname + '/frequency_data/forbidden/FORBIDDEN_' + c.code + '.json' ) ) {
            menuJSON[MENU_COUNTRY].submenu.push (
                {
                    'label' : c.label,
                    'code'  : c.code,
                    'type'  : 'radio' ,
                    'checked': country_code===c.code?true:false,
                    click () { wc.send ( 'SET_COUNTRY', { country_code : c.code, country_label : c.label } ); }
                }
            );
        }
    });

    // Add ports (will be filled later via renderer event)
    var portMenuJSON = { label: 'Port', submenu: [] };
    menuJSON.push ( portMenuJSON  );

    // Add scan devices
    var scanDeviceMenuJSON = { label: 'Device', submenu: [{
        label : 'RF Explorer',
        code  : 'RF_EXPLORER',
        type  : 'radio',
        click () {
            menuJSON[MENU_SCAN_DEVICE].submenu[0].checked = true
            menuJSON[MENU_SCAN_DEVICE].submenu[1].checked = false
            wc.send ( 'SET_SCAN_DEVICE', { scanDevice : 'RF_EXPLORER' } )
        }
    }, {
        label : 'Tiny SA',
        code  : 'TINY_SA',
        type  : 'radio',
        click () {
            menuJSON[MENU_SCAN_DEVICE].submenu[0].checked = false
            menuJSON[MENU_SCAN_DEVICE].submenu[1].checked = true
            wc.send ( 'SET_SCAN_DEVICE', { scanDevice : 'TINY_SA' } )
        }
    }, {
        label : 'Settings',
        code  : 'DEVICE_SETTINGS',
        click () { wc.send ( 'DEVICE_SETTINGS', {} ); }
    }]};
    menuJSON.push ( scanDeviceMenuJSON );

    // Add tools menu
    var toolsMenuJSON = { label: 'Tools', submenu: [
        { label: 'Export', submenu: [
            {
                label: "Shure WW6 and IAS (CSV Format)", click () {
                    dialog.showSaveDialog ({
                        title: "Export for Shure WW6 and IAS (CSV Format)",
                        filters: [ {name: "CSV", extensions: ["csv"]} ]
                    }).then ( (res) => {
                        wc.send ( 'EXPORT_WW6_IAS_CSV', { filename : res.filePath })
                    })
                }
            }, {
                label: "Sennheiser Wireless System Manager (CSV Format)", click () {
                    dialog.showSaveDialog ({
                        title: "Export for Sennheiser Wireless System Manager (CSV Format)",
                        filters: [ {name: "CSV", extensions: ["csv"]} ]
                    }).then ( (res) => {
                        wc.send ( 'EXPORT_WSM_CSV', { filename : res.filePath })
                    })
                }
            }
        ]},
        { label : 'MX Linux Workaround',
            type  : 'checkbox',
            click (ev) {
                let elem = menuJSON[MENU_TOOLS].submenu.find((elem)=> elem.label === 'MX Linux Workaround')
                elem.checked = ev.checked;
                wc.send ( 'MX_LINUX_WORKAROUND', { enabled : ev.checked ? true : false })
            }
        },
        { label: 'Reset Peak             R', click () {
            wc.send ('RESET_PEAK', {});
        }},
        { label: 'Reset Settings', click () {
            wc.send ('RESET_SETTINGS', {});
        }},
        { label: 'Dark mode',
            type: 'checkbox',
            click (ev) {
                let elem = menuJSON[MENU_TOOLS].submenu.find((elem)=> elem.label === 'Dark mode')
                elem.checked = ev.checked;
                wc.send ( 'DARK_MODE', { enabled : ev.checked ? true : false })
            }
        }
    ]};
    menuJSON.push ( toolsMenuJSON );

    // Add Test Menu
    //menuJSON.push ({ label: 'Test', submenu: [] });
    //menuJSON[MENU_TEST].submenu.push ({ label : 'Test Text' });
    //Object.entries (FREQ_TEST).forEach ( testFreqData => {
    //    let key    = testFreqData[0];
    //    //let value  = testFreqData[1];
    //    menuJSON[MENU_TEST].submenu.push (
    //        {
    //           'label'  : key,
    //       //     'code'   : value,
    //            'type'   : 'checkbox',
    //             click () {wc.send ("SET_TEST_PRESET", { test_vendor : key}); }
    //        }
    //       );
    //       //log.info ("Test_Vendor " + key + " , Test_Channels " + JSON.stringify(value, ["label"]));
    //});

    // Add help menu
    var helpMenuJSON = { label: 'Help', submenu: [
        { label: "Documentation", click () { openHelpWindow() ; } },
        { label: "Download logs", click () { 
            dialog.showSaveDialog ({
                title: "Save logs",
                defaultPath: 'logs.zip'
            }).then ( (res) => {
                zipLogs(res.filePath)
            })
        } },
        { label: "Developer tools", click () { wc.openDevTools(); } },
        { label: "About"        , click () { openAboutWindow(); } }
    ]};
    menuJSON.push ( helpMenuJSON  );

    /**************************/
    /*        Country         */
    /**************************/
    ipcMain.on ( "SET_COUNTRY", (event, data) => {
        menuJSON[MENU_COUNTRY].submenu.forEach ( function ( elem ) {
            if ( elem.code === data.country_code ) {
                elem.checked = true;

                // Need to rebuild menu to reflect attribute (in this case the 'checked' attribute)
                Menu.setApplicationMenu ( Menu.buildFromTemplate ( menuJSON ) );
            }
        })
    })

    /**************************/
    /*         Port           */
    /**************************/
    ipcMain.on ( "SET_PORT", (event, data) => {
        SerialPort.list().then ( (ports, err) => {
            if ( err ) {
                log.info ( err );
                return;
            }

            globalPorts = ports

            let portPathArr = [];
            menuJSON[MENU_PORT].submenu = []
    
            globalPorts.forEach ( ( port ) => {
                portPathArr.push ( port.path );
            });
    
            menuJSON[MENU_PORT].submenu[0] = {
                label: 'Auto',
                type: 'radio',
                checked: (data.portPath === undefined || data.portPath === 'AUTO') ? true : false,
                click () { wc.send ( 'SET_PORT',  portPathArr ); }
            }
    
            portPathArr.forEach ( port => {
                menuJSON[MENU_PORT].submenu.push (
                    {
                        'label' : port,
                        'type'  : 'radio',
                        'checked': data.portPath === port ? true : false,
                        click () { wc.send ( 'SET_PORT', { port : port } ); }
                    }
                );
            });
        
            // Need to rebuild menu to reflect attribute (in this case the 'checked' attribute)
            Menu.setApplicationMenu ( Menu.buildFromTemplate ( menuJSON ) );
        })
    })

    /**************************/
    /*        Device          */
    /**************************/
    ipcMain.on ( "SET_SCAN_DEVICE", (event, data) => {
        switch ( data.scanDevice ) {
            case 'RF_EXPLORER':
                menuJSON[MENU_SCAN_DEVICE].submenu[0].checked = true
                menuJSON[MENU_SCAN_DEVICE].submenu[1].checked = false
                break

            case 'TINY_SA':
                menuJSON[MENU_SCAN_DEVICE].submenu[0].checked = false
                menuJSON[MENU_SCAN_DEVICE].submenu[1].checked = true
                break
        }

        // Need to rebuild menu to reflect attribute (in this case the 'checked' attribute)
        Menu.setApplicationMenu ( Menu.buildFromTemplate ( menuJSON ) )
    })

    /**************************/
    /*         Tools          */
    /**************************/
    ipcMain.on ( "MX_LINUX_WORKAROUND", (event, data) => {
        let elem = menuJSON[MENU_TOOLS].submenu.find((elem)=> elem.label === 'MX Linux Workaround')
        elem.checked = data.checked;
        // Need to rebuild menu to reflect attribute (in this case the 'checked' attribute)
        Menu.setApplicationMenu ( Menu.buildFromTemplate ( menuJSON ) )
    });

    ipcMain.on ( "DARK_MODE", (event, data) => {
        let elem = menuJSON[MENU_TOOLS].submenu.find((elem)=> elem.label === 'Dark mode')
        elem.checked = data.checked;
        // Need to rebuild menu to reflect attribute (in this case the 'checked' attribute)
        Menu.setApplicationMenu ( Menu.buildFromTemplate ( menuJSON ) )
    })

    ipcMain.on ( "SET_MAIN_WINDOW_TITLE", (event, data) => {
        mainWindow.setTitle ( productName + " V" + version + "   ( " + data + " )")
    })

    /************/
    /*   Init   */
    /************/
    // Add serial ports to the menu
    SerialPort.list().then ( (ports, err) => {
        if ( err ) {
            log.info ( err );
            return;
        }

        globalPorts = ports
    })

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
        aboutWindow = new BrowserWindow({width: 500, height: 170, resizable: false});
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
