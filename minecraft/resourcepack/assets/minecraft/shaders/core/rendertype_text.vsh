#version 150
#moj_import <fog.glsl>

in vec3 Position;
in vec4 Color;
in vec2 UV0;
in ivec2 UV2;

uniform sampler2D Sampler0;
uniform sampler2D Sampler2;

out float vertexDistance;
out vec4 vertexColor;
out vec2 texCoord0;
flat out int minimapMarker;
out vec2 minimapGuiPosition;
out vec2 minimapGuiSize;

bool sentinelAt(vec2 uv) {
    vec4 texel = textureLod(Sampler0, uv, 0.0);
    return texel.a > 0.99 && texel.a < 0.999 &&
           texel.r > 0.06 && texel.r < 0.08 &&
           texel.g > 0.98 && texel.g < 1.0 &&
           texel.b > 0.92 && texel.b < 0.96;
}

bool isMinimapMarker(vec2 uv) {
    vec2 texel = 1.0 / vec2(textureSize(Sampler0, 0));
    // UV0 lies on glyph quad edges. Probe the four adjacent texel centers so
    // every corner sees the solid 8x8 sentinel without sampling atlas gutters.
    return sentinelAt(uv + texel * vec2(-0.75, -0.75)) || sentinelAt(uv + texel * vec2(0.75, -0.75)) ||
           sentinelAt(uv + texel * vec2(-0.75, 0.75)) || sentinelAt(uv + texel * vec2(0.75, 0.75));
}

void main() {
    gl_Position = ProjMat * ModelViewMat * vec4(Position, 1.0);
    vec4 viewPosition = ModelViewMat * vec4(Position, 1.0);
    vertexDistance = length(viewPosition.xyz);
    vertexColor = Color * texelFetch(Sampler2, UV2 / 16, 0);
    texCoord0 = UV0;

    bool marker = isMinimapMarker(UV0);
    minimapMarker = marker ? 1 : 0;
    if (marker) {
        float guiWidth = 2.0 / ProjMat[0][0];
        float guiHeight = 2.0 / abs(ProjMat[1][1]);
        float dx = guiWidth * 0.5 - 36.0;
        float dy = 24.0; // bossbar title center (12px from top) to map center (36px)
        gl_Position.x += dx * (2.0 / guiWidth) * gl_Position.w;
        gl_Position.y -= dy * (2.0 / guiHeight) * gl_Position.w;
        vec2 ndc = gl_Position.xy / gl_Position.w;
        minimapGuiPosition = vec2((ndc.x + 1.0) * guiWidth * 0.5,
                                  (1.0 - ndc.y) * guiHeight * 0.5);
        minimapGuiSize = vec2(guiWidth, guiHeight);
    } else {
        minimapGuiPosition = vec2(0.0);
        minimapGuiSize = vec2(0.0);
    }
}
