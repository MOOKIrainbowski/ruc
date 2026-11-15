#version 330

#moj_import <minecraft:fog.glsl>
#moj_import <minecraft:dynamictransforms.glsl>

uniform sampler2D Sampler0;

in float sphericalVertexDistance;
in float cylindricalVertexDistance;
in vec4 vertexColor;
in vec2 texCoord0;
in vec4 minimapTextColor;
flat in int minimapKind;
in vec2 minimapGuiPosition;
in vec2 minimapGuiSize;

out vec4 fragColor;

bool isTag(vec4 c, vec3 tag) {
    return all(lessThan(abs(c.rgb - tag / 255.0), vec3(0.018))) && c.a > 0.001 && c.a < 0.02;
}

void main() {
    if (minimapKind != 0) {
        if (minimapGuiPosition.x < minimapGuiSize.x - 68.0 || minimapGuiPosition.x >= minimapGuiSize.x - 4.0 ||
            minimapGuiPosition.y < 4.0 || minimapGuiPosition.y >= 68.0) discard;
        vec4 texel = texture(Sampler0, texCoord0);
        vec4 color;
        if (minimapKind == 1) {
            if (isTag(texel, vec3(17.0, 253.0, 239.0))) discard;
            color = vec4(texel.rgb, 1.0) * ColorModulator;
        } else if (minimapKind == 2) {
            color = vec4(minimapTextColor.rgb, 1.0) * ColorModulator;
        } else if (minimapKind == 3) {
            if (texel.a < 0.001 || isTag(texel, vec3(17.0, 239.0, 253.0))) discard;
            color = vec4(minimapTextColor.rgb, 1.0) * ColorModulator;
        } else {
            color = texel * vertexColor * ColorModulator;
            if (color.a < 0.1) discard;
        }
        fragColor = apply_fog(color, sphericalVertexDistance, cylindricalVertexDistance,
                              FogEnvironmentalStart, FogEnvironmentalEnd, FogRenderDistanceStart,
                              FogRenderDistanceEnd, FogColor);
        return;
    }

    // Keep the 1.21.11 vanilla text path unchanged for non-minimap glyphs.
    vec4 color = texture(Sampler0, texCoord0) * vertexColor * ColorModulator;
    if (color.a < 0.1) {
        discard;
    }
    fragColor = apply_fog(color, sphericalVertexDistance, cylindricalVertexDistance, FogEnvironmentalStart, FogEnvironmentalEnd, FogRenderDistanceStart, FogRenderDistanceEnd, FogColor);
}
