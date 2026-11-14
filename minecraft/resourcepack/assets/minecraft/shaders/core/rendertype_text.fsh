#version 150
#moj_import <fog.glsl>

uniform sampler2D Sampler0;
uniform vec4 ColorModulator;

in float vertexDistance;
in vec4 vertexColor;
in vec2 texCoord0;
flat in int minimapMarker;
in vec2 minimapGuiPosition;
in vec2 minimapGuiSize;

out vec4 fragColor;

void main() {
    if (minimapMarker != 0) {
        if (minimapGuiPosition.x < minimapGuiSize.x - 68.0 || minimapGuiPosition.x > minimapGuiSize.x - 4.0 ||
            minimapGuiPosition.y < 4.0 || minimapGuiPosition.y > 68.0) discard;
    }
    vec4 color = texture(Sampler0, texCoord0) * vertexColor * ColorModulator;
    if (color.a < 0.1) discard;
    fragColor = apply_fog(color, vertexDistance, FogEnvironmentalStart, FogEnvironmentalEnd,
                          FogRenderDistanceStart, FogRenderDistanceEnd, FogColor);
}
