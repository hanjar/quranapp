import { Directive, output, ElementRef, OnInit, OnDestroy, inject } from '@angular/core';

/**
 * Swipe gesture directive for page navigation.
 * Detects horizontal swipe on the host element and emits direction events.
 *
 * Usage: <div appSwipe (swipeLeft)="nextPage()" (swipeRight)="prevPage()">
 */
@Directive({
    selector: '[appSwipe]',
    standalone: true,
})
export class SwipeDirective implements OnInit, OnDestroy {
    private el = inject(ElementRef);

    swipeLeft = output<void>();
    swipeRight = output<void>();

    private startX = 0;
    private startY = 0;
    private startTime = 0;

    private readonly THRESHOLD = 50;        // Minimum px distance
    private readonly MAX_VERTICAL = 100;    // Max vertical movement (ignore if mostly vertical)
    private readonly MAX_TIME = 500;        // Max ms for swipe

    private boundStart = this.onTouchStart.bind(this);
    private boundEnd = this.onTouchEnd.bind(this);

    ngOnInit() {
        const el = this.el.nativeElement as HTMLElement;
        el.addEventListener('touchstart', this.boundStart, { passive: true });
        el.addEventListener('touchend', this.boundEnd, { passive: true });
    }

    ngOnDestroy() {
        const el = this.el.nativeElement as HTMLElement;
        el.removeEventListener('touchstart', this.boundStart);
        el.removeEventListener('touchend', this.boundEnd);
    }

    private onTouchStart(e: TouchEvent) {
        const touch = e.touches[0];
        this.startX = touch.clientX;
        this.startY = touch.clientY;
        this.startTime = Date.now();
    }

    private onTouchEnd(e: TouchEvent) {
        const touch = e.changedTouches[0];
        const dx = touch.clientX - this.startX;
        const dy = touch.clientY - this.startY;
        const dt = Date.now() - this.startTime;

        // Ignore if too slow, too short, or too vertical
        if (dt > this.MAX_TIME) return;
        if (Math.abs(dx) < this.THRESHOLD) return;
        if (Math.abs(dy) > this.MAX_VERTICAL) return;

        if (dx < 0) {
            this.swipeLeft.emit();
        } else {
            this.swipeRight.emit();
        }
    }
}
