import { ErrorHandler, Injectable } from '@angular/core';
import { reportError } from './storage/error-reporter';

/** Keeps Angular's console logging and also sends uncaught errors as automatic reports. */
@Injectable()
export class ReportingErrorHandler extends ErrorHandler {
  override handleError(error: unknown): void {
    super.handleError(error);
    const err = error instanceof Error ? error : new Error(String(error));
    // The first stack frame says where it broke without sending the whole trace.
    const where = err.stack?.split('\n').find((l) => l.includes('at ') || l.includes('@'))?.trim() ?? '';
    reportError({
      op: 'app',
      name: (err.name || 'Error').slice(0, 60),
      message: `${err.message}${where ? ' | ' + where : ''}`.slice(0, 300),
      at: Date.now(),
    });
  }
}
