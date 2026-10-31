import { startWritePage } from '../write/page';

document.addEventListener('DOMContentLoaded', () => {
	void startWritePage(document.getElementById('write-root') as HTMLElement);
});
