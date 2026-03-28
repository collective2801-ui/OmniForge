function getBrowserWindow(browserWindow = globalThis.window) {
  return browserWindow && typeof browserWindow === 'object' ? browserWindow : null;
}

function getRecognitionConstructor(browserWindow = globalThis.window) {
  const resolvedWindow = getBrowserWindow(browserWindow);

  if (!resolvedWindow) {
    return null;
  }

  return resolvedWindow.SpeechRecognition || resolvedWindow.webkitSpeechRecognition || null;
}

function createVoiceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeSpeechError(errorCode) {
  switch (errorCode) {
    case 'no-speech':
      return createVoiceError('no-speech', 'No speech was detected. Try speaking again.');
    case 'audio-capture':
      return createVoiceError('audio-capture', 'No microphone was available for voice input.');
    case 'not-allowed':
    case 'service-not-allowed':
      return createVoiceError('not-allowed', 'Microphone access was blocked by the browser.');
    case 'network':
      return createVoiceError('network', 'Speech recognition could not reach the recognition service.');
    case 'aborted':
      return createVoiceError('aborted', 'Voice input was stopped before completion.');
    default:
      return createVoiceError(
        errorCode || 'speech-error',
        'Voice recognition failed before the command was captured.',
      );
  }
}

function createUnsupportedController(message, onError) {
  const error = createVoiceError('unsupported', message);

  queueMicrotask(() => {
    if (typeof onError === 'function') {
      onError(error);
    }
  });

  return {
    supported: false,
    stop() {},
    abort() {},
    getState() {
      return {
        supported: false,
        listening: false,
        transcript: '',
        finalTranscript: '',
        interimTranscript: '',
      };
    },
  };
}

export function isVoiceInputSupported(browserWindow = globalThis.window) {
  return Boolean(getRecognitionConstructor(browserWindow));
}

export function startVoiceInput(options = {}) {
  const browserWindow = getBrowserWindow(options.browserWindow);
  const Recognition = getRecognitionConstructor(browserWindow);

  if (!Recognition) {
    return createUnsupportedController(
      'This browser does not support the Web Speech API for voice commands.',
      options.onError,
    );
  }

  const recognition = new Recognition();
  const language =
    typeof options.lang === 'string' && options.lang.trim().length > 0
      ? options.lang.trim()
      : browserWindow?.navigator?.language ?? 'en-US';
  let listening = false;
  let finalTranscript = '';
  let interimTranscript = '';

  recognition.lang = language;
  recognition.continuous = options.continuous === true;
  recognition.interimResults = options.interimResults !== false;
  recognition.maxAlternatives = 1;

  function getState() {
    const transcript = [finalTranscript.trim(), interimTranscript.trim()]
      .filter(Boolean)
      .join(' ')
      .trim();

    return {
      supported: true,
      listening,
      transcript,
      finalTranscript: finalTranscript.trim(),
      interimTranscript: interimTranscript.trim(),
      language,
    };
  }

  function emitStateChange() {
    if (typeof options.onStateChange === 'function') {
      options.onStateChange(getState());
    }
  }

  recognition.onstart = () => {
    listening = true;
    finalTranscript = '';
    interimTranscript = '';
    if (typeof options.onStart === 'function') {
      options.onStart(getState());
    }
    emitStateChange();
  };

  recognition.onresult = (event) => {
    interimTranscript = '';

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result?.[0]?.transcript?.trim() ?? '';

      if (!transcript) {
        continue;
      }

      if (result.isFinal) {
        finalTranscript = `${finalTranscript} ${transcript}`.trim();
      } else {
        interimTranscript = `${interimTranscript} ${transcript}`.trim();
      }
    }

    const state = getState();

    if (typeof options.onResult === 'function') {
      options.onResult({
        ...state,
        isFinal: interimTranscript.length === 0 && finalTranscript.length > 0,
      });
    }

    emitStateChange();
  };

  recognition.onerror = (event) => {
    listening = false;
    const error = normalizeSpeechError(event?.error);

    if (typeof options.onError === 'function') {
      options.onError(error);
    }

    emitStateChange();
  };

  recognition.onend = () => {
    const state = getState();
    listening = false;

    if (typeof options.onStop === 'function') {
      options.onStop({
        ...state,
        completed: state.finalTranscript.length > 0,
      });
    }

    emitStateChange();
  };

  try {
    recognition.start();
  } catch (error) {
    return createUnsupportedController(
      error?.message ?? 'Voice recognition could not be started.',
      options.onError,
    );
  }

  return {
    supported: true,
    stop() {
      recognition.stop();
    },
    abort() {
      recognition.abort();
    },
    getState,
  };
}

export default {
  isVoiceInputSupported,
  startVoiceInput,
};
