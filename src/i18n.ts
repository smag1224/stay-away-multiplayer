type Lang = 'en' | 'ru';

const translations: Record<string, Record<Lang, string>> = {
  // Lobby
  'lobby.title': { en: 'Нечто', ru: 'Нечто' },
  'lobby.subtitle': { en: 'The Thing from the Deep Abyss', ru: 'Из глубокой бездны' },
  'lobby.addPlayer': { en: 'Add Player', ru: 'Добавить игрока' },
  'lobby.startGame': { en: 'Start Game', ru: 'Начать игру' },
  'lobby.playerName': { en: 'Player name', ru: 'Имя игрока' },
  'lobby.minPlayers': { en: 'Need at least 4 players', ru: 'Нужно минимум 4 игрока' },
  'lobby.maxPlayers': { en: 'Maximum 12 players', ru: 'Максимум 12 игроков' },
  'lobby.remove': { en: 'Remove', ru: 'Удалить' },

  // Role reveal
  'reveal.title': { en: 'Role Reveal', ru: 'Раздача карт' },
  'reveal.passTo': { en: 'Pass the device to', ru: 'Передайте устройство игроку' },
  'reveal.showCards': { en: 'Show My Cards', ru: 'Показать мои карты' },
  'reveal.yourCards': { en: 'Your cards:', ru: 'Ваши карты:' },
  'reveal.done': { en: 'Done, Next Player', ru: 'Готово, следующий' },
  'reveal.startPlaying': { en: 'Start Playing!', ru: 'Начать игру!' },

  // Game table
  'game.deck': { en: 'Deck', ru: 'Колода' },
  'game.discard': { en: 'Discard', ru: 'Сброс' },
  'game.step': { en: 'Step', ru: 'Шаг' },
  'game.draw': { en: 'Draw a card', ru: 'Возьмите карту' },
  'game.playOrDiscard': { en: 'Play or discard a card', ru: 'Сыграйте или сбросьте карту' },
  'game.trade': { en: 'Trade with neighbor', ru: 'Обмен с соседом' },
  'game.tradeResponse': { en: 'Waiting for response...', ru: 'Ожидание ответа...' },
  'game.showHand': { en: 'Show My Hand', ru: 'Показать руку' },
  'game.hideHand': { en: 'Hide Hand', ru: 'Скрыть руку' },
  'game.drawCard': { en: 'Draw Card', ru: 'Взять карту' },
  'game.endTurn': { en: 'End Turn', ru: 'Завершить ход' },
  'game.direction.cw': { en: 'Clockwise', ru: 'По часовой' },
  'game.direction.ccw': { en: 'Counter-clockwise', ru: 'Против часовой' },
  'game.turn': { en: 'Turn', ru: 'Ход' },
  'game.declareVictory': { en: 'Declare Victory', ru: 'Объявить победу' },
  'game.play': { en: 'Play', ru: 'Сыграть' },
  'game.discard_btn': { en: 'Discard', ru: 'Сбросить' },
  'game.offer': { en: 'Offer', ru: 'Предложить' },
  'game.accept': { en: 'Accept Trade', ru: 'Принять обмен' },
  'game.defend': { en: 'Play Defense', ru: 'Защититься' },
  'game.selectTarget': { en: 'Select target', ru: 'Выберите цель' },
  'game.cancel': { en: 'Cancel', ru: 'Отмена' },
  'game.confirm': { en: 'OK', ru: 'ОК' },
  'game.quarantine': { en: 'Quarantine', ru: 'Карантин' },
  'game.lockedDoor': { en: 'Locked Door', ru: 'Запертая дверь' },
  'game.dead': { en: 'Dead', ru: 'Мёртв' },
  'game.you': { en: '(You)', ru: '(Вы)' },
  'game.eventLog': { en: 'Event Log', ru: 'Журнал событий' },
  'game.keepCard': { en: 'Keep', ru: 'Оставить' },
  'game.cardsOf': { en: "'s cards:", ru: ', карты:' },
  'game.viewedCard': { en: 'Viewed card:', ru: 'Просмотренная карта:' },
  'game.whiskyReveal': { en: 'shows all cards:', ru: 'показывает все карты:' },

  // Game over
  'gameover.title': { en: 'Game Over', ru: 'Конец игры' },
  'gameover.humansWin': { en: 'Humans Win!', ru: 'Люди побеждают!' },
  'gameover.thingWins': { en: 'The Thing Wins!', ru: 'Нечто побеждает!' },
  'gameover.thingSoloWins': { en: 'The Thing Wins Alone!', ru: 'Нечто побеждает в одиночку!' },
  'gameover.role': { en: 'Role', ru: 'Роль' },
  'gameover.status': { en: 'Status', ru: 'Статус' },
  'gameover.alive': { en: 'Alive', ru: 'Жив' },
  'gameover.eliminated': { en: 'Eliminated', ru: 'Уничтожен' },
  'gameover.winner': { en: 'Winner!', ru: 'Победитель!' },
  'gameover.playAgain': { en: 'Play Again', ru: 'Играть снова' },
  'gameover.thing': { en: 'The Thing', ru: 'Нечто' },
  'gameover.human': { en: 'Human', ru: 'Человек' },
  'gameover.infected': { en: 'Infected', ru: 'Заражённый' },

  // Cards
  'card.event': { en: 'Event', ru: 'Событие' },
  'card.panic': { en: 'Panic', ru: 'Паника' },
  'card.action': { en: 'Action', ru: 'Действие' },
  'card.defense': { en: 'Defense', ru: 'Защита' },
  'card.obstacle': { en: 'Obstacle', ru: 'Препятствие' },
  'card.infection': { en: 'Infection', ru: 'Заражение' },
  'card.promo': { en: 'Promo', ru: 'Промо' },

  // Lang
  'lang.switch': { en: 'RU', ru: 'EN' },
};

export function t(key: string, lang: Lang): string {
  return translations[key]?.[lang] ?? key;
}
