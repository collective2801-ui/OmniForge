import path from 'node:path';
import fs from 'fs-extra';
import platformConfig from '../config/platform.config.js';
import { ensureDirectory } from './fileSystem.js';

function serializeMeta(meta) {
  if (meta === undefined) {
    return '';
  }

  if (typeof meta === 'string') {
    return meta;
  }

  return JSON.stringify(meta);
}

function formatLogLine({ timestamp, level, message, meta }) {
  const serializedMeta = serializeMeta(meta);
  return serializedMeta
    ? `[${timestamp}] ${level.toUpperCase()} ${message} ${serializedMeta}`
    : `[${timestamp}] ${level.toUpperCase()} ${message}`;
}

export class Logger {
  constructor({
    logToFile = true,
    logFilePath = platformConfig.logFileLocation,
  } = {}) {
    this.logToFile = logToFile;
    this.logFilePath = logFilePath;
  }

  async appendToFile(line) {
    const logDirectory = path.dirname(this.logFilePath);
    await ensureDirectory(logDirectory);
    await fs.appendFile(this.logFilePath, `${line}\n`, 'utf8');
  }

  async log(level, message, meta) {
    if (typeof message !== 'string' || message.trim().length === 0) {
      throw new TypeError('Log message must be a non-empty string.');
    }

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message: message.trim(),
      meta,
    };

    const formattedLine = formatLogLine(entry);

    if (level === 'error') {
      console.error(formattedLine);
    } else if (level === 'warning') {
      console.warn(formattedLine);
    } else {
      console.info(formattedLine);
    }

    if (this.logToFile) {
      await this.appendToFile(formattedLine);
    }

    return entry;
  }

  info(message, meta) {
    return this.log('info', message, meta);
  }

  warn(message, meta) {
    return this.log('warning', message, meta);
  }

  error(message, meta) {
    return this.log('error', message, meta);
  }
}

const logger = new Logger();

export default logger;
