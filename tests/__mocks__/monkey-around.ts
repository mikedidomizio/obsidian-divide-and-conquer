/** Mock for the monkey-around library */
export function around(obj: any, map: Record<string, (old: any) => any>) {
	const originals: Record<string, any> = {};
	for (const [key, fn] of Object.entries(map)) {
		originals[key] = obj[key];
		obj[key] = fn(obj[key]);
	}
	return () => {
		for (const [key, fn] of Object.entries(originals)) {
			obj[key] = fn;
		}
	};
}

