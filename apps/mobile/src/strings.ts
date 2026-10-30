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
    signOut: 'Выйти',
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
