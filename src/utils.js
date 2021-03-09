import { validateTypes } from 'types-validate-assert'

// Checks a hash to see if it's a Lamden Public or Private key
export const isLamdenKey = ( key ) => {
    if (validateTypes.isStringHex(key) && key.length === 64) return true;
    return false;
};