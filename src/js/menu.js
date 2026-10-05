const { Menu, app } = require('electron')
function createMenu (mainWindow) {
  //reinitiate i18 to reload language from settings
  var i18n = new(require('./../../translations/i18n'))
  
  const application = {
    label: i18n.__("ScdoWallet"),
    submenu: [
      {
        label: i18n.__("Toggle Developer Options"),
        accelerator: "CmdOrCtrl+shift+I",
        // click: () => {
        //   mainWindow.webContents.openDevTools()
        // }
        role: 'toggledevtools'
      },
      {
        label: i18n.__("Version") + app.getVersion(),
        enabled: false
      },
      {
        type: "separator"
      },
      {
        label: i18n.__("Minimize"),
        accelerator: "CmdOrCtrl+M",
        role: "minimize"
      },
      {
        label: i18n.__("Toggle Fullscreen"),
        accelerator: "CmdOrCtrl+shift+F",
        role: 'togglefullscreen'
      },
      {
        label: i18n.__("Close"),
        accelerator: "CmdOrCtrl+W",
        role: "close"
      },
      {
        label: i18n.__("Quit"),
        accelerator: "CmdOrCtrl+Q",
        click: () => {
          app.quit()
        }
      }
    ]
  }
  
  const file = {
    label: i18n.__("File"),
    submenu:[
      {
        label: i18n.__("Create Keyfile(s)"),
        accelerator: "CmdOrCtrl+N",
        click: () => {
          mainWindow.webContents.executeJavaScript('addKeyfilePopup()');
        }
      },
      {
        label: i18n.__("Import Keyfile(s)"),
        accelerator: "CmdOrCtrl+I",
        click: () => {
            // var importKey = require('./src/js/index.js');
            mainWindow.webContents.executeJavaScript('importAccounts()')
            // importKey();
            // console.log("really")
        }
      }
      // {
      //   label: i18n.__("Manage Keyfile(s)"),
      //   accelerator: "CmdOrCtrl+K",
      //   enabled:true,
      //   click: () => {
      //     mainWindow.webContents.executeJavaScript("shell.openItem(client.accountPath)");  
      //   }
      // },
      // {
      //   label: i18n.__("Manage Trasaction(s)"),
      //   enabled:true,
      //   click: () => {
      //     mainWindow.webContents.executeJavaScript("shell.openItem(client.rcPath)");  
      //   }
      // }
    ]
  }
  
  const edit = {
    label: i18n.__("Edit"),
    submenu: [
      {
        label: i18n.__("Copy"),
        accelerator: "CmdOrCtrl+C",
        selector: "copy:"
      },
      {
        label: i18n.__("Paste"),
        accelerator: "CmdOrCtrl+V",
        selector: "paste:"
      },
      {
        label: i18n.__("Select All"),
        accelerator: "CmdOrCtrl+A",
        selector: "selectAll:"
      },
      {
        label: i18n.__("Refresh"),
        accelerator: "CmdOrCtrl+R",
        click: function () {
          mainWindow.reload();
        }
      }
    ]
  }
  
  const language = {
    label:i18n.__("Language"),
    submenu: [
      {
        label: "English",
        type: "radio",
        id:"EN",
        click: function () {
          // global.languageSetting = "en"
          // mainWindow.webContents.executeJavaScript('switchLanguage()');
          refreshMenu(mainWindow,"EN");
        }
      },
      {
        label: "中文",
        type: "radio",
        id:"CN",
        click: function () {
          // global.languageSetting = "cn"
          // mainWindow.webContents.executeJavaScript('switchLanguage()');
          refreshMenu(mainWindow,"CN");
        },
      }
    ]
  }
  
  var langused = i18n.lang()
  
  for (var item of language.submenu) {
    console.log();
    if ( item.id == langused) {
      item.checked = true;
    }
  }
  
  const view = {
    label: i18n.__("View"),
    submenu: [
      language,
      {
        label: i18n.__("Show NetWork Info"),
        accelerator: "CmdOrCtrl+E",
        click: () => {
          mainWindow.webContents.executeJavaScript('showInfo()')
        }
      },
      {
        label: i18n.__("Edit NetWork Info"),
        accelerator: "CmdOrCtrl+shift+N",
        click: () => {
          mainWindow.webContents.executeJavaScript('toggleEditNetwork()')
        }
      }
    ]
  }
  
  const help = {
    label: i18n.__("Help"),
    role: "help",
    submenu: [
      {
        label: i18n.__("Toggle Tooltip"),
        accelerator: "CmdOrCtrl+T",
        click: async () => {
          mainWindow.webContents.executeJavaScript('toggleTooltip()')
        }
      },
      {
        label:  i18n.__('Learn More'),
        click: async () => {
          const { shell } = require("electron")
          await shell.openExternal("https://scdoproject.gitbook.io/scdo-wiki/en/wallet")
        }
      }
      // ,
      // {
      //   label: "了解更多",
      //   click: async () => {
      //     const { shell } = require("electron")
      //     await shell.openExternal("https://scdo-scdotech.gitbook.io/wiki/chinese/ScdoWallet-windows")
      //   }
      // }
    ]
  }
  
  const remit = {
    label: i18n.__("Remittance"),
    click: () => {
      mainWindow.webContents.executeJavaScript('openRemittance()')
    }
  }

  const template = [
    application,
    file,
    edit,
    view,
    remit,
    help
  ]
  
  // return 
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function refreshMenu(win, lang) {
  var i18n = new(require('./../../translations/i18n'));
  i18n.langChange(lang);
  createMenu(win);
  win.webContents.executeJavaScript('switchLanguage()');
  // win.reload();
  win.webContents.executeJavaScript('location.reload()');
}

module.exports.createMenu = createMenu