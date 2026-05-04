export const ORDERED_LIST_REF = "cw-ordered-list";

export const COLORS = {
    text: "1A1A1A",
    border: "D1D5DB",
    borderDark: "666666",
    link: "333333",
    codeBg: "F5F5F5",
    quoteBg: "FAFAFA",
    thBg: "E5E5E5",
} as const;

export const FONTS = {
    serif: "Times New Roman",
    mono: "Consolas",
    math: "Cambria Math",
} as const;

export const SIZES = {
    // docx uses half-points; 24 = 12pt
    body: 24,
    code: 20,
    h1: 40,
    h2: 32,
    h3: 28,
    h4: 26,
    h5: 24,
    h6: 22,
} as const;

// Word "Normal" baseline + GOST-like overrides for exported DOCX.
export const GOST_LAYOUT = {
    page: {
        widthMm: 210,
        heightMm: 297,
        marginTopMm: 20,
        marginRightMm: 15,
        marginBottomMm: 20,
        marginLeftMm: 30,
    },
    paragraph: {
        // ~1.25 cm first-line indent.
        firstLineTwip: 708,
        // 1.15 line spacing in twentieths of a point.
        lineTwip: 276,
    },
} as const;
