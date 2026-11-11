// Cliente mínimo de la API REST de Trello con el token del usuario.
import { APP_KEY } from './config.js';

const BASE = 'https://api.trello.com/1';

export function createApi(token) {
  async function call(method, path, params) {
    const qs = new URLSearchParams(Object.assign({ key: APP_KEY, token }, params || {}));
    const res = await fetch(BASE + path + '?' + qs.toString(), { method });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error('Trello ' + res.status + ': ' + text.slice(0, 200));
      err.status = res.status;
      throw err;
    }
    return res.status === 200 ? res.json().catch(() => null) : null;
  }

  return {
    async loadBoard(boardId) {
      const [lists, cards] = await Promise.all([
        call('GET', '/boards/' + boardId + '/lists', { filter: 'open', fields: 'name,pos,closed' }),
        call('GET', '/boards/' + boardId + '/cards', {
          filter: 'open',
          fields: 'name,desc,idList,pos,closed,shortUrl,labels',
          checklists: 'all'
        })
      ]);
      return { lists, cards };
    },
    updateItem(cardId, itemId, fields) {
      return call('PUT', '/cards/' + cardId + '/checkItem/' + itemId, fields);
    },
    addItem(checklistId, name, extra) {
      return call('POST', '/checklists/' + checklistId + '/checkItems', Object.assign({ name, pos: 'bottom' }, extra || {}));
    },
    deleteItem(cardId, itemId) {
      return call('DELETE', '/cards/' + cardId + '/checkItem/' + itemId);
    },
    createChecklist(cardId, name) {
      return call('POST', '/cards/' + cardId + '/checklists', { name });
    }
  };
}
