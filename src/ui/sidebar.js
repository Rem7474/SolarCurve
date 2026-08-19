import { sidebarToggle, sidebarEl, sidebarOverlay } from '../dom.js';

export function initSidebarToggle() {
  if (sidebarToggle && sidebarEl) {
    sidebarToggle.addEventListener('click', () => {
      const open = sidebarEl.classList.toggle('open');
      sidebarOverlay.classList.toggle('active', open);
      sidebarToggle.classList.toggle('is-hidden', open);
    });
  }
  if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', () => {
      closeSidebar();
    });
  }
}

export function closeSidebar() {
  if (sidebarEl) sidebarEl.classList.remove('open');
  if (sidebarOverlay) sidebarOverlay.classList.remove('active');
  if (sidebarToggle) sidebarToggle.classList.remove('is-hidden');
}
