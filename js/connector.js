// Conector del Power-Up: añade el botón «Cronograma» en la cabecera del tablero.
import { APP_KEY, APP_NAME, APP_AUTHOR } from './config.js?v=3';

const ICON = new URL('../img/icon.svg', import.meta.url).href;
const ICON_DARK = new URL('../img/icon-light.svg', import.meta.url).href;

window.TrelloPowerUp.initialize({
  'board-buttons': () => [{
    icon: { dark: ICON_DARK, light: ICON },
    text: 'Cronograma',
    condition: 'always',
    callback: (t) => t.modal({
      url: new URL('../timeline.html?v=4', import.meta.url).href,
      fullscreen: true,
      title: 'Cronograma'
    })
  }]
}, { appKey: APP_KEY, appName: APP_NAME, appAuthor: APP_AUTHOR });
