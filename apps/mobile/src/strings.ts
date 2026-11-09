// The ONLY place for user-facing copy (Russian). Screens import from here and never
// inline a string. Code, comments and identifiers stay in English.
import type { StoryStyle } from '@sleep-stories/contracts';

export const strings = {
  common: {
    next: 'Дальше',
    back: 'Назад',
    retry: 'Повторить',
    loading: 'Загрузка',
  },

  auth: {
    appName: 'Sleep Stories',
    tagline: 'Помогает уснуть, когда в голове слишком много мыслей',
    intro: 'Войдите или создайте аккаунт. В нём сохранятся ваши темы, голос и библиотека.',
    continueWithApple: 'Продолжить с Apple',
    continueWithGoogle: 'Продолжить с Google',
    orByEmail: 'или по почте',
    createAccount: 'Создать аккаунт',
    haveAccount: 'У меня есть аккаунт',
    emailPlaceholder: 'Почта',
    emailLabel: 'Почта',
    goToSignIn: 'Войти',
    passwordLabel: 'Пароль',
    signUp: {
      eyebrow: 'Новый аккаунт',
      title: 'Создайте аккаунт',
      passwordPlaceholder: 'Придумайте пароль',
      hint: 'Не короче 8 символов',
      submit: 'Создать аккаунт',
      switchPrompt: 'Уже есть аккаунт?',
      switchAction: 'Войти',
    },
    signIn: {
      eyebrow: 'С возвращением',
      title: 'Вход по почте',
      passwordPlaceholder: 'Пароль',
      forgotPassword: 'Забыли пароль?',
      submit: 'Войти',
      switchPrompt: 'Нет аккаунта?',
      switchAction: 'Создать',
    },
    errors: {
      emailRequired: 'Введите почту',
      emailInvalid: 'Проверьте адрес почты',
      passwordTooShort: 'Пароль должен быть не короче 8 символов',
      passwordRequired: 'Введите пароль',
      invalidCredentials: 'Неверная почта или пароль',
      userAlreadyExists: 'Аккаунт с такой почтой уже есть. Войдите в него',
      weakPassword: 'Пароль слишком простой. Придумайте другой',
      rateLimited: 'Слишком много попыток. Подождите немного и повторите',
      confirmationRequired: 'Аккаунт создан. Подтвердите почту по письму, затем войдите',
      network: 'Нет связи с сервером. Проверьте интернет и повторите',
      generic: 'Что-то пошло не так. Повторите позже',
    },
  },

  onboarding: {
    stepOf: (current: number, total: number) => `Шаг ${current} из ${total}`,
    voice: {
      title: 'Выберите голос',
      subtitle: 'Его можно сменить в настройках',
      playSample: 'Послушать голос',
      stopSample: 'Остановить',
      playFailed: 'Не удалось воспроизвести образец. Попробуйте ещё раз',
      loading: 'Загружаем голоса',
      loadFailed: 'Не удалось загрузить голоса. Проверьте интернет и попробуйте ещё раз',
    },
    interests: {
      title: 'Что вам интересно',
      subtitle: 'Выберите несколько тем и стилей',
      stylesHeading: 'Стили',
      customPlaceholder: 'Своя тема',
      addCustomLabel: 'Добавить тему',
      removeCustomLabel: 'Убрать тему',
      loading: 'Загружаем темы',
      loadFailed: 'Не удалось загрузить темы. Проверьте интернет и попробуйте ещё раз',
    },
    permissions: {
      title: 'Разрешения',
      doNotDisturbTitle: 'Уведомления и «Не беспокоить»',
      doNotDisturbBody: 'Чтобы звонки и сообщения не будили вас во время историй.',
      footnote: 'Разрешения можно изменить в настройках',
      done: 'Готово',
    },
    errors: {
      saveFailed: 'Что-то пошло не так, попробуйте ещё раз',
      unavailable: 'Не удалось подключиться. Проверьте интернет и попробуйте ещё раз',
    },
  },

  home: {
    title: 'Главный экран',
  },

  nav: {
    today: 'Сегодня',
    topics: 'Темы',
    settings: 'Настройки',
  },

  // Temporary «Настройки» screen: a sign-out button for testing on a phone.
  settings: {
    logout: 'Выйти',
  },

  // The screen «Сегодня» (design frames 2a, 2a·1 to 2a·14). Number-dependent phrases are
  // functions that take already-declined nouns: the declension itself lives in
  // features/today/plural.ts, so copy stays here and logic stays testable.
  today: {
    greeting: 'Добрый вечер',
    title: 'Что послушаем сегодня перед сном?',

    // The nouns the captions decline, as [one, few, many] (1, 2 to 4, 5 to 20).
    nouns: {
      generation: ['генерация', 'генерации', 'генераций'],
      story: ['история', 'истории', 'историй'],
    },

    mainButton: {
      start: 'Начать',
      create: 'Создать',
      creating: 'Создаётся…',
    },

    captions: {
      creating: 'Когда всё будет готово, можно начинать',
      // «3 истории · 12 мин»
      allReady: (count: number, storiesNoun: string, minutes: number) =>
        `${count} ${storiesNoun} · ${minutes} мин`,
      // «Займёт ~3 мин · 2 генерации из 3 оставшихся»
      willCreate: (need: number, generationsNoun: string, left: number, remainingWord: string) =>
        `Займёт ~3 мин · ${need} ${generationsNoun} из ${left} ${remainingWord}`,
      remainingOne: 'оставшейся',
      remainingMany: 'оставшихся',
      // «Нужно 3 генерации, осталось 1. Можно выбрать готовые истории.»
      shortage: (need: number, generationsNoun: string, left: number) =>
        `Нужно ${need} ${generationsNoun}, осталось ${left}. Можно выбрать`,
      noGenerations: 'Генераций не осталось. Можно выбрать',
      readyStoriesLink: 'готовые истории',
      sentenceEnd: '.',
    },

    queue: {
      title: 'Очередь на ночь',
      remove: 'Убрать',
    },

    row: {
      // «История 01»
      position: (position: string) => `История ${position}`,
      notReady: 'Не готова',
      creating: 'Создаётся',
      creatingEstimate: '~3 мин',
      failed: 'Не удалось',
      retry: 'Повторить',
      // PASS 2: «✓ Прослушана» in the data line of a queue row (a check icon, then this text).
      heard: 'Прослушана',
    },

    // PASS 2: the ⋯ menu of the queue header (design frame 2a·16): a sheet titled
    // «Очередь на ночь» with two rows. The rebuild row has a subtitle; there is no undo.
    queueMenu: {
      open: 'Действия с очередью',
      title: 'Очередь на ночь',
      // The design's wording (frame 2a·16).
      add: 'Добавить истории',
      rebuild: 'Пересобрать очередь',
      rebuildHint: 'Только непрослушанные истории',
    },

    // PASS 2: the toast after «Пересобрать очередь» (design 2a toast, label + title, no «Вернуть»):
    // «Пересобрали очередь» over «3 истории, которые вы ещё не слышали». The pronoun agrees with
    // the noun («1 история, которую»), so both are declined by the caller with pluralRu:
    // rebuilt.title(n, pluralRu(n, nouns.story), pluralRu(n, rebuilt.which)).
    rebuilt: {
      label: 'Пересобрали очередь',
      which: ['которую', 'которые', 'которые'],
      title: (count: number, storiesNoun: string, whichWord: string) =>
        `${count} ${storiesNoun}, ${whichWord} вы ещё не слышали`,
    },

    menu: {
      createNow: 'Создать сейчас',
      createNowCost: (left: number) => `1 из ${left}`,
      createNowUnavailable: 'Генераций не осталось',
      another: 'Другая история',
      anotherHint: 'Тот же стиль, новый рассказ',
      chooseFromTopics: 'Выбрать из тем',
      remove: 'Убрать',
    },

    hint: {
      title: 'Эта история ещё не готова',
      dismiss: 'Понятно',
      body: (left: number, limit: number) =>
        `Её нужно создать — это займёт около 3 минут и потратит 1 генерацию. Сейчас осталось ${left} из ${limit}.`,
    },

    toasts: {
      creating: 'Создаётся',
      replaced: 'Заменили на',
      removed: 'Убрали',
    },

    errors: {
      notEnoughGenerations: 'Генераций не хватает',
      noOtherStory: 'Других историй пока нет',
      generic: 'Не получилось. Попробуйте ещё раз',
      queueChanged: 'Очередь изменилась',
      loadFailed: 'Не удалось загрузить очередь',
      loadFailedBody: 'Проверьте интернет и повторите',
      retry: 'Повторить',
      nothingToCollect: 'Пока не из чего собрать. Загляните позже',
    },

    empty: {
      eyebrow: 'Очередь на ночь',
      idleTitle: 'Пока пусто',
      idleBody: 'Выберите истории сами или соберём подборку из ваших интересов.',
      collectingTitle: 'Собираем подборку',
      collectingBody:
        'Подбираем три истории по вашим интересам. Можно закрыть приложение, очередь появится здесь.',
      collectButton: 'Собрать подборку',
      chooseButton: 'Выбрать истории',
      collectingPill: 'Собираем…',
      // «Три истории на темы: космос, история, мифы»
      interestsCaption: (interests: string) => `Три истории на темы: ${interests}`,
    },

    a11y: {
      reorderHandle: 'Переместить историю',
      openMenu: 'Открыть меню истории',
      closeSheet: 'Закрыть',
      removeRow: (title: string) => `Убрать «${title}»`,
    },
  },

  // The screens «Темы» and «Замена» (design frames s-topics and s-replace). The «Расскажи про…»
  // field of the designs is not built yet, so it has no copy here.
  topics: {
    title: 'Темы',
    chips: {
      all: 'Все',
    },
    // The two filter chips under the heading (design frames s-topics, s-topics-filter, s-replace).
    // Each opens a sheet with one choice of three. `chip` is the label while the filter is off,
    // `short` the label of the chip while a choice is on (the chip is then highlighted), and
    // choosing «Все» resets it.
    filters: {
      ready: {
        chip: 'Готовность',
        title: 'Готовность',
        options: {
          all: 'Все',
          ready: 'Только готовые',
          not: 'Только неготовые',
        },
        short: {
          ready: 'Готовые',
          not: 'Неготовые',
        },
      },
      heard: {
        chip: 'Прослушивание',
        title: 'Прослушивание',
        options: {
          all: 'Все',
          new: 'Только непрослушанные',
          heard: 'Только прослушанные',
        },
        short: {
          new: 'Непрослушанные',
          heard: 'Прослушанные',
        },
      },
    },
    empty: 'Под этот фильтр пока ничего нет',
    row: {
      notReady: 'Не готова',
      creating: 'Создаётся',
      creatingEstimate: '~3 мин',
      failed: 'Не удалось',
      // PASS 2: «✓ Прослушана» in the data line of a topic row (a check icon, then this text).
      heard: 'Прослушана',
    },
    // The plate above the bottom bar: «В очереди: 3» and the link to «Сегодня».
    plate: {
      inQueue: (count: number) => `В очереди: ${count}`,
      toQueue: 'К очереди',
    },
    errors: {
      loadFailed: 'Не удалось загрузить темы',
      loadFailedBody: 'Проверьте интернет и повторите',
      retry: 'Повторить',
      unavailable: 'Эта тема сейчас недоступна',
    },
    a11y: {
      addToQueue: (title: string) => `Добавить «${title}» в очередь`,
      removeFromQueue: (title: string) => `Убрать «${title}» из очереди`,
      filters: 'Фильтры',
      selectTopic: (title: string) => `Выбрать «${title}»`,
    },
  },

  replace: {
    title: 'Замена',
    instead: 'Вместо',
    confirm: 'Заменить',
  },

  // The stories player (design frames 3a to 3d).
  player: {
    // 3c: the waves, and the touch that continues.
    wavesTitle: 'Вы спите?',
    wavesBody: 'Если нет — коснитесь экрана в любом месте, и истории продолжатся',
    wavesTap: 'Нажмите в любом месте',
    // Shown instead of the hint while the request for more stories is in flight.
    continuing: 'Ищем истории…',
    // 3d: the only text of the asleep screen (the design's «Засыпаю» label is not used).
    asleep: 'Спокойной ночи',
    // Toast on «Сегодня» when a touch during the waves found nothing ready.
    noneReady: 'Готовых историй не нашлось — нужна генерация',
    a11y: {
      leave: 'Выйти из плеера',
      dim: 'Приглушить экран',
      previous: 'Сначала',
      next: 'Следующая история',
      play: 'Играть',
      pause: 'Пауза',
      seek: 'Положение в истории',
      progress: (elapsed: string, total: string) => `${elapsed} из ${total}`,
      undim: 'Вернуться к плееру',
      continueStories: 'Продолжить истории',
      wake: 'Перейти на «Сегодня»',
    },
  },

  gate: {
    errorTitle: 'Не удалось загрузить данные',
    errorBody: 'Проверьте интернет и повторите',
  },
} as const;

// Labels and descriptions as drawn in the interests-and-styles design.
export const styleCopy = {
  facts: { label: 'Факты', description: 'спокойно и по делу' },
  fairy_tale: { label: 'Сказка', description: 'мягкий вымысел' },
  history: { label: 'История', description: 'рассказ о событиях и людях' },
} as const satisfies Record<StoryStyle, { readonly label: string; readonly description: string }>;
