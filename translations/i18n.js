const path = require("path")
const fs = require('fs');
let loadedDictionary;
let loadedLanguage;

module.exports = i18n;

function i18n() {
    const ScdoClient = require('./../src/api/scdoClient.js');
    var scdoClient = new ScdoClient;
    var settings = JSON.parse(fs.readFileSync(scdoClient.configpath), 'utf8')

    // A saved EN or CN wins. migrateConfig already stored the first-launch locale.
    const { resolveLang } = require('./../src/js/uiLang')
    var saved = resolveLang(settings && settings.lang, '')
    global.languageSetting = saved;

    loadedLanguage = saved;
    let langfile = loadedLanguage + '.json';
    var file = path.join(__dirname, langfile)
    if (!fs.existsSync(file)) file = path.join(__dirname, 'CN.json')
    loadedDictionary = JSON.parse(fs.readFileSync(file, 'utf8'))
}

i18n.prototype.__ = function(phrase) {
    let translation = loadedDictionary[phrase];
    if(translation === undefined) {
         translation = phrase;
         console.log(phrase, ": not translated");
    }
    return translation;
}

i18n.prototype.lang = function() {
  return loadedLanguage;
}

i18n.prototype.langChange = function(lang) {
  const ScdoClient = require('./../src/api/scdoClient.js');
  var scdoClient = new ScdoClient;
  var settings = JSON.parse(fs.readFileSync(scdoClient.configpath), 'utf8')
  settings.lang = lang;
  fs.writeFileSync(scdoClient.configpath, JSON.stringify(settings))
}
