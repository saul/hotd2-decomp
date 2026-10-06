/**
 * The sRGB transfer pair, for the shaders that do D3D7's arithmetic on
 * framebuffer bytes inside three.js's linear pipeline: `render/fog.ts`'s
 * blend and `render/lighting.ts`'s light equation.
 *
 * Spelled out rather than taken from three's `colorspace_pars_fragment`,
 * which has the encode half (`sRGBTransferOETF`) and no decode half, and
 * whose position relative to the chunks that need it is an ordering detail
 * of a file this code does not own. The constants are three's own, so the
 * round trip is exact.
 *
 * Guarded, because both users put it in the same fragment shader: the fog
 * puts it in `fog_pars_fragment`, which every material includes, and the
 * lighting puts it at `common`, ahead of that, so it does not depend on the
 * fog having patched anything.
 *
 * `max(x, 0)` guards `pow`: a negative component is undefined behaviour there,
 * and one can arrive from a material that subtracts.
 */
export const SRGB_TRANSFER_GLSL = /* glsl */`
#ifndef HOD2_SRGB_TRANSFER
#define HOD2_SRGB_TRANSFER
vec3 hod2SrgbEncode( vec3 c ) {
	c = max( c, vec3( 0.0 ) );
	return mix( pow( c, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ),
	            c * 12.92, vec3( lessThanEqual( c, vec3( 0.0031308 ) ) ) );
}
vec3 hod2SrgbDecode( vec3 c ) {
	c = max( c, vec3( 0.0 ) );
	return mix( pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ),
	            c / 12.92, vec3( lessThanEqual( c, vec3( 0.04045 ) ) ) );
}
#endif
`;
