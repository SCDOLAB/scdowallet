// 3.1.0 screenshot harness. Opens the layout page with mocked real-shape data
// and writes PNGs under doc/shots-3.1.0/. The page is labelled 測試資料.
'use strict'
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const outDir = path.join(__dirname, '..', 'doc', 'shots-3.1.0')
const shots = [
  'home-collapsed',
  'home-expanded',
  'mining-stopped',
  'mining-expanded',
  'receive',
  'send-step1',
  'settings',
  'cat-chat'
]

app.commandLine.appendSwitch('disable-gpu')

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true })
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: true,
    frame: true,
    titleBarStyle: 'default',
    backgroundColor: '#F2F2F7',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })
  win.setTitle('SCDO Wallet')
  await win.loadFile(path.join(__dirname, 'shots-310.html'))
  for (const name of shots) {
    const shown = await win.webContents.executeJavaScript('window.showShot(' + JSON.stringify(name) + ')')
    if (shown !== name) throw new Error('shot did not render: ' + name)
    await new Promise(r => setTimeout(r, 400))
    const image = await win.webContents.capturePage()
    const file = path.join(outDir, name + '.png')
    fs.writeFileSync(file, image.toPNG())
    console.log(path.relative(path.join(__dirname, '..'), file))
  }
  app.exit(0)
}).catch((err) => {
  console.error(err)
  app.exit(1)
})
