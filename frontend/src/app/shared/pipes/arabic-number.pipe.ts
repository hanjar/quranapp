import { Pipe, PipeTransform } from '@angular/core';

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

@Pipe({ name: 'arabicNumber' })
export class ArabicNumberPipe implements PipeTransform {
  transform(value: number | string): string {
    return String(value)
      .split('')
      .map(d => ARABIC_DIGITS[parseInt(d)] ?? d)
      .join('');
  }
}
