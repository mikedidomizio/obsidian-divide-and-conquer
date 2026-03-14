/** Minimal mock for tinycolor2 */
function tinycolor(color: string) {
	return {
		spin: (_deg: number) => tinycolor(color),
		darken: (_amount: number) => tinycolor(color),
		toHexString: () => "#000000",
	};
}
module.exports = tinycolor;

