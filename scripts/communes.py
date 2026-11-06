"""The Communes around Paris that the site covers.

The list is the one place in the code that names them. The codes are the
current INSEE codes from geo.api.gouv.fr. Paris itself is not in the list:
it has the 20 Arrondissement codes in ``PARIS_CODES``.
"""
DEPARTMENT_COMMUNES: dict[str, tuple[str, ...]] = {
    "92": ("92002", "92004", "92007", "92009", "92012", "92014", "92019", "92020", "92022", "92023", "92024", "92025", "92026", "92032", "92033", "92035", "92036", "92040", "92044", "92046", "92047", "92048", "92049", "92050", "92051", "92060", "92062", "92063", "92064", "92071", "92072", "92073", "92075", "92076", "92077", "92078"),
    "93": ("93001", "93005", "93006", "93007", "93008", "93010", "93013", "93014", "93015", "93027", "93029", "93030", "93031", "93032", "93033", "93039", "93045", "93046", "93047", "93048", "93049", "93050", "93051", "93053", "93055", "93057", "93061", "93062", "93063", "93064", "93066", "93070", "93071", "93072", "93073", "93074", "93077", "93078", "93079"),
    "94": ("94001", "94002", "94003", "94004", "94011", "94015", "94016", "94017", "94018", "94019", "94021", "94022", "94028", "94033", "94034", "94037", "94038", "94041", "94042", "94043", "94044", "94046", "94047", "94048", "94052", "94053", "94054", "94055", "94056", "94058", "94059", "94060", "94065", "94067", "94068", "94069", "94070", "94071", "94073", "94074", "94075", "94076", "94077", "94078", "94079", "94080", "94081"),
}
# Major towns farther out, in departments 77, 78, 91 and 95.
MAJOR_TOWNS: tuple[str, ...] = ("95018", "95127", "77108", "91174", "91228", "77186", "91377", "77284", "77288", "78551", "95585", "78586", "78646")
# All 135 Commune codes: the three departments, then the major towns.
COMMUNE_CODES: tuple[str, ...] = tuple(code for codes in DEPARTMENT_COMMUNES.values() for code in codes) + MAJOR_TOWNS
PARIS_CODES: tuple[str, ...] = tuple(f"751{n:02d}" for n in range(1, 21))
# Codes that DVF may still use for a Commune that has merged into another one.
OLD_COMMUNE_CODES: dict[str, str] = {"93059": "93066"}  # Pierrefitte-sur-Seine merged into Saint-Denis.


def current_code(code: str) -> str:
    """Return the current code of a Commune.

    Parameters
    ----------
    code : str
        A Commune code, current or old.

    Returns
    -------
    str
        The current code. A code that is not old comes back unchanged.

    Examples
    --------
    .. code-block:: python

        current_code("93059")  # "93066"
    """
    return OLD_COMMUNE_CODES.get(code, code)


def commune_group(code: str) -> str:
    """Return the group of a Commune.

    Parameters
    ----------
    code : str
        A current Commune code from ``COMMUNE_CODES``.

    Returns
    -------
    str
        ``"92"``, ``"93"`` or ``"94"`` for a Commune of that department,
        otherwise ``"major"``.

    Examples
    --------
    .. code-block:: python

        commune_group("93066")  # "93"
        commune_group("78646")  # "major"
    """
    return code[:2] if code in COMMUNE_CODES and code not in MAJOR_TOWNS else "major"
