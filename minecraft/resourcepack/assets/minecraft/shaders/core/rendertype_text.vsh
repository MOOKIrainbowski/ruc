#version 330

#moj_import <minecraft:fog.glsl>
#moj_import <minecraft:dynamictransforms.glsl>
#moj_import <minecraft:projection.glsl>

in vec3 Position;
in vec4 Color;
in vec2 UV0;
in ivec2 UV2;

uniform sampler2D Sampler0;
uniform sampler2D Sampler2;

out float sphericalVertexDistance;
out float cylindricalVertexDistance;
out vec4 vertexColor;
out vec2 texCoord0;
out vec4 minimapTextColor;
flat out int minimapKind;
out vec2 minimapGuiPosition;
out vec2 minimapGuiSize;

bool nearTag(vec4 c, vec3 tag, bool legacy) {
    bool rgbMatches = all(lessThan(abs(c.rgb - tag), vec3(0.018)));
    return legacy ? rgbMatches && c.a > 0.99 && c.a < 0.999
                  : rgbMatches && c.a > 0.001 && c.a < 0.02;
}

void main() {
    gl_Position = ProjMat * ModelViewMat * vec4(Position, 1.0);
    sphericalVertexDistance = fog_spherical_distance(Position);
    cylindricalVertexDistance = fog_cylindrical_distance(Position);
    vertexColor = Color * texelFetch(Sampler2, UV2 / 16, 0);
    texCoord0 = UV0;

    minimapTextColor = Color;
    minimapKind = 0;
    minimapGuiPosition = vec2(0.0);
    minimapGuiSize = vec2(0.0);

    // One shared four-texel probe replaces four separate four-sample tag searches.
    vec2 texel = 1.0 / vec2(textureSize(Sampler0, 0));
    vec4 c0 = textureLod(Sampler0, UV0 + texel * vec2(-0.75, -0.75), 0.0);
    vec4 c1 = textureLod(Sampler0, UV0 + texel * vec2( 0.75, -0.75), 0.0);
    vec4 c2 = textureLod(Sampler0, UV0 + texel * vec2(-0.75,  0.75), 0.0);
    vec4 c3 = textureLod(Sampler0, UV0 + texel * vec2( 0.75,  0.75), 0.0);
    bool mapTag = nearTag(c0, vec3(17.0, 253.0, 239.0) / 255.0, false) ||
                  nearTag(c1, vec3(17.0, 253.0, 239.0) / 255.0, false) ||
                  nearTag(c2, vec3(17.0, 253.0, 239.0) / 255.0, false) ||
                  nearTag(c3, vec3(17.0, 253.0, 239.0) / 255.0, false);
    bool pixelTag = nearTag(c0, vec3(253.0, 17.0, 239.0) / 255.0, false) ||
                    nearTag(c1, vec3(253.0, 17.0, 239.0) / 255.0, false) ||
                    nearTag(c2, vec3(253.0, 17.0, 239.0) / 255.0, false) ||
                    nearTag(c3, vec3(253.0, 17.0, 239.0) / 255.0, false);
    bool arrowTag = nearTag(c0, vec3(17.0, 239.0, 253.0) / 255.0, false) ||
                    nearTag(c1, vec3(17.0, 239.0, 253.0) / 255.0, false) ||
                    nearTag(c2, vec3(17.0, 239.0, 253.0) / 255.0, false) ||
                    nearTag(c3, vec3(17.0, 239.0, 253.0) / 255.0, false);
    bool legacyTag = nearTag(c0, vec3(17.0, 253.0, 239.0) / 255.0, true) ||
                     nearTag(c1, vec3(17.0, 253.0, 239.0) / 255.0, true) ||
                     nearTag(c2, vec3(17.0, 253.0, 239.0) / 255.0, true) ||
                     nearTag(c3, vec3(17.0, 253.0, 239.0) / 255.0, true);
    if (mapTag) minimapKind = 1;
    else if (pixelTag) minimapKind = 2;
    else if (arrowTag) minimapKind = 3;
    else if (legacyTag) minimapKind = 4;

    if (minimapKind != 0) {
        float guiWidth = 2.0 / ProjMat[0][0];
        float guiHeight = 2.0 / abs(ProjMat[1][1]);
        float dx = guiWidth * 0.5 - 36.0;
        float dy = 24.0;
        if (minimapKind == 1) {
            float mapDx = floor(Color.r * 255.0 + 0.5) - 128.0;
            float mapDy = floor(Color.g * 255.0 + 0.5) - 128.0;
            dx -= mapDx;
            dy -= mapDy;
        }
        gl_Position.x += dx * (2.0 / guiWidth) * gl_Position.w;
        gl_Position.y -= dy * (2.0 / guiHeight) * gl_Position.w;
        vec2 ndc = gl_Position.xy / gl_Position.w;
        minimapGuiPosition = vec2((ndc.x + 1.0) * guiWidth * 0.5,
                                  (1.0 - ndc.y) * guiHeight * 0.5);
        minimapGuiSize = vec2(guiWidth, guiHeight);
    }
}
