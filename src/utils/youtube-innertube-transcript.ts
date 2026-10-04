// "m:ss" / "h:mm:ss" label for a position in milliseconds.
export const formatClock = (milliseconds: number): string => {
	const total = Math.max(0, Math.floor(milliseconds / 1000)), h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
	return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(s).padStart(2, '0');
};
