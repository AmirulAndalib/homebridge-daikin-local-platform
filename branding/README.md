# Branding

Icon assets for `homebridge-daikin-local-platform`.

| File | Use |
| --- | --- |
| `icon.svg` | Primary icon, 512×512. Source of truth. |
| `icon.png` | 512×512 with transparency — the file to submit to the Homebridge plugin registry. |
| `icon-100.png` | Small raster for the README header. |
| `icon-mono.svg` | Tile-less glyph in `currentColor`, for inline use in the settings UI. |

## The mark

A roof, a wall-mounted indoor unit below it, and three arcs of air spreading
down out of the vent. It stays readable when small: at 32 px the roof, the unit
and the airflow are still three distinct shapes.

The arcs bulge downward on purpose — arcs bulging upward read as a Wi-Fi
symbol, which is the wrong idea for an air conditioner.

## Colour

Flat `#0097E0`, Daikin Blue (Pantone Process Blue). The artwork on top is white;
the vent slot is `#003F63` at 32% opacity.

Daikin's secondary light blue `#54C3F1` is too pale to carry white artwork — the
faintest airflow arc disappears at small sizes — so the tile stays flat rather
than fading into it.

## Trademark

The plugin is unofficial and is not affiliated with, endorsed by, or sponsored
by Daikin Industries, Ltd. The main README carries that disclaimer for users.

The corporate blue is used so the plugin is recognisable as the Daikin one. The
mark itself contains no Daikin trademark: no wordmark, no logotype, no
brand-specific typeface, and no copy of any product's design. The indoor unit is
a generic split-type silhouette common to the whole category. "Daikin" appears
only in the plugin's name and prose, describing which hardware the plugin talks
to, and never as part of the icon.
