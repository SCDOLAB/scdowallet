// 3.1.0 screenshot harness. Opens the layout page with mocked real-shape data
// and writes PNGs under doc/shots-3.1.0/ at 1024x700 and 1280x800.
// The page is labelled 測試資料. A sideways scrollbar fails the run.
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
const sizes = [
  { w: 1024, h: 700, dir: '1024x700' },
  { w: 1280, h: 800, dir: '1280x800' }
]

app.commandLine.appendSwitch('disable-gpu')

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true })
  for (const name of fs.readdirSync(outDir)) {
    const p = path.join(outDir, name)
    if (name.endsWith('.png')) fs.unlinkSync(p)
  }
  const win = new BrowserWindow({
    width: 1400,
    height: 1000,
    useContentSize: true,
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
  win.webContents.debugger.attach('1.3')
  for (const size of sizes) {
    const dir = path.join(outDir, size.dir)
    fs.mkdirSync(dir, { recursive: true })
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: size.w,
      height: size.h,
      deviceScaleFactor: 1,
      mobile: false
    })
    await new Promise(r => setTimeout(r, 150))
    for (const name of shots) {
      const shown = await win.webContents.executeJavaScript('window.showShot(' + JSON.stringify(name) + ')')
      if (shown !== name) throw new Error('shot did not render: ' + name)
      await new Promise(r => setTimeout(r, 250))
      const box = await win.webContents.executeJavaScript('[window.innerWidth, window.innerHeight, document.documentElement.clientWidth, document.documentElement.scrollWidth]')
      if (box[0] !== size.w || box[1] !== size.h) throw new Error(name + ' viewport ' + box[0] + 'x' + box[1])
      if (box[3] > box[2] + 1) throw new Error(name + ' scrolls sideways at ' + size.dir)
      const shot = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
        clip: { x: 0, y: 0, width: size.w, height: size.h, scale: 1 }
      })
      const file = path.join(dir, name + '.png')
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
      console.log(path.relative(path.join(__dirname, '..'), file))
    }
  }
  app.exit(0)
}).catch((err) => {
  console.error(err)
  app.exit(1)
})
