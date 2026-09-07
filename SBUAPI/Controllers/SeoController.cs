using System.Xml.Linq;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using SBUAPI.Options;

namespace SBUAPI.Controllers;

[AllowAnonymous]
[ApiExplorerSettings(IgnoreApi = true)]
public sealed class SeoController : ControllerBase
{
    private readonly SiteOptions _site;

    public SeoController(IOptions<SiteOptions> site)
    {
        _site = site.Value;
    }

    [HttpGet("/robots.txt")]
    [ResponseCache(Duration = 3600, Location = ResponseCacheLocation.Any)]
    public IActionResult Robots()
    {
        var lines = new List<string>
        {
            "User-agent: *",
            "Allow: /",
            "Disallow: /Admin",
            "Disallow: /admin",
            "Disallow: /account/",
            "Disallow: /Account/",
            "Disallow: /api/"
        };

        var sitemapUrl = _site.GetAbsoluteUrl("sitemap.xml");
        if (sitemapUrl is not null)
        {
            lines.Add("");
            lines.Add($"Sitemap: {sitemapUrl}");
        }

        return Content(string.Join("\n", lines), "text/plain; charset=utf-8");
    }

    [HttpGet("/sitemap.xml")]
    [ResponseCache(Duration = 3600, Location = ResponseCacheLocation.Any)]
    public IActionResult Sitemap()
    {
        var homeUrl = _site.GetAbsoluteUrl("");
        if (homeUrl is null)
            return NotFound();

        XNamespace sitemapNamespace = "http://www.sitemaps.org/schemas/sitemap/0.9";
        var document = new XDocument(
            new XDeclaration("1.0", "UTF-8", null),
            new XElement(
                sitemapNamespace + "urlset",
                new XElement(
                    sitemapNamespace + "url",
                    new XElement(sitemapNamespace + "loc", homeUrl))));

        return Content(
            document.ToString(SaveOptions.DisableFormatting),
            "application/xml; charset=utf-8");
    }
}
