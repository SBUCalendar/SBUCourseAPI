namespace SBUAPI.Options;

public sealed class SiteOptions
{
    public const string SectionName = "Site";

    public string BaseUrl { get; set; } = "";

    public string Name { get; set; } = "SbuCalendar";

    public string Title { get; set; } = "برنامه هفتگی دانشگاه شهید بهشتی";

    public string Description { get; set; } =
        "جست‌وجوی دروس دانشگاه شهید بهشتی، بررسی تداخل کلاس و امتحان و ساخت برنامه هفتگی دانشجویی.";

    public string? GetBaseUrl()
    {
        var candidate = BaseUrl.Trim().TrimEnd('/');
        if (!Uri.TryCreate(candidate, UriKind.Absolute, out var uri))
            return null;

        return uri.Scheme is "http" or "https" ? candidate : null;
    }

    public string? GetAbsoluteUrl(string path)
    {
        var baseUrl = GetBaseUrl();
        if (baseUrl is null) return null;
        return $"{baseUrl}/{path.TrimStart('/')}";
    }
}
