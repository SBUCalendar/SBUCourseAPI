namespace SBUAPI.Services;

public static class PersianTextNormalizer
{
    public static string Normalize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return "";

        return string.Concat(value.Trim().Select(character => character switch
        {
            'ي' or 'ى' => 'ی',
            'ك' => 'ک',
            '۰' or '٠' => '0',
            '۱' or '١' => '1',
            '۲' or '٢' => '2',
            '۳' or '٣' => '3',
            '۴' or '٤' => '4',
            '۵' or '٥' => '5',
            '۶' or '٦' => '6',
            '۷' or '٧' => '7',
            '۸' or '٨' => '8',
            '۹' or '٩' => '9',
            _ => character
        }));
    }
}
