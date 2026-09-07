using SBUAPI.Models;
using SbuCourses.Models;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace SBUAPI.Services;

public sealed class BehestanClient
{
    private readonly HttpClient _httpClient;

    public BehestanClient(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public async Task<BehestanFetchResult> FetchCoursesAsync(
        BehestanSessionInput session,
        CancellationToken cancellationToken = default)
    {
        var body = new
        {
            rp = new
            {
                ft = "1",
                f = "102",
                seq = session.Seq,
                subfrm = "0",
                sid = session.Sid,
                ct = "",
                sp = JsonSerializer.Serialize(new
                {
                    UsrType = "0",
                    TrmType = "2"
                }),
                ut = "0"
            },

            t = JsonSerializer.Serialize(new
            {
                Ticket = session.Ticket,
                IdleTime = 10
            }),

            r = new
            {
                Ra3 = "0",
                BMu = BuildBMu(),
                BMv = BuildBMv(),
                AFek = "1"
            },

            act = "08",
            MaxHlp = 200
        };

        var json = JsonSerializer.Serialize(body);

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            "frm/BAS0237_CMP_ViewReport/BAS0237_CMP_ViewReport.svc/"
        );

        request.Content = new StringContent(
            json,
            Encoding.UTF8,
            "application/json"
        );

        request.Headers.Accept.Add(
            new MediaTypeWithQualityHeaderValue("application/json")
        );

        request.Headers.TryAddWithoutValidation(
            "X-Requested-With",
            "XMLHttpRequest"
        );

        request.Headers.TryAddWithoutValidation(
            "Origin",
            "https://ems.sbu.ac.ir"
        );

        request.Headers.Referrer =
            new Uri("https://ems.sbu.ac.ir/browser/fa/");

        var pCookie = session.PCookie.Trim();

        if (pCookie.StartsWith("p=", StringComparison.OrdinalIgnoreCase))
            pCookie = pCookie[2..];

        request.Headers.TryAddWithoutValidation(
            "Cookie",
            $"p={pCookie}"
        );

        using var response =
            await _httpClient.SendAsync(request, cancellationToken);

        var responseText =
            await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            return new BehestanFetchResult(
                false,
                (int)response.StatusCode,
                null,
                null,
                $"HTTP {(int)response.StatusCode} {response.ReasonPhrase}"
            );
        }

        try
        {
            using var document = JsonDocument.Parse(responseText);

            var root = document.RootElement;

            if (!root.TryGetProperty("outpar", out var outpar))
            {
                return new BehestanFetchResult(
                    false,
                    (int)response.StatusCode,
                    null,
                    null,
                    "outpar در پاسخ وجود ندارد."
                );
            }

            var ret = outpar.TryGetProperty("_ret", out var retElement)
                ? retElement.GetString()
                : null;

            var bmt = outpar.TryGetProperty("BMt", out var bmtElement)
                ? bmtElement.GetString()
                : null;

            return new BehestanFetchResult(
                ret == "0",
                (int)response.StatusCode,
                ret,
                bmt,
                ret == "0" ? null : "Behestan returned an error."
            );
        }
        catch (JsonException)
        {
            return new BehestanFetchResult(
                false,
                (int)response.StatusCode,
                null,
                null,
                "پاسخ سرور JSON معتبر نبود."
            );
        }
    }

    private static string BuildBMu()
    {
        return """
        <Root>
        <N id="4" ft="3" fs="1" B="" Q="" A="" S="" F1="4051"/>
        <N id="6" ft="3" fs="1" B="" Q="" A="" S="" M=""/>
        <N id="12" ft="3" fs="1" B="B" Q="1" A="0" S="1"/>
        <N id="16" ft="3" fs="1" B="B" Q="3" A="0" S="1"/>
        <N id="22" ft="3" fs="1" B="S" Q="4" A="0" S=""/>
        <N id="30" ft="3" fs="1" B="" Q="" A="" S=""/>
        <N id="32" ft="3" fs="1" B="" Q="" A="" S=""/>
        <N id="40" ft="3" fs="1" B="" Q="" A="" S=""/>
        <N id="52" ft="3" fs="1" B="" Q="" A="" S=""/>
        <N id="56" ft="3" fs="1" B="" Q="" A="" S=""/>
        <N id="68" ft="3" fs="1" B="" Q="" A="" S=""/>
        <N id="99" ft="3" fs="1" B="" Q="" A="" S=""/>
        <N id="101" ft="3" fs="1" B="" Q="" A="" S=""/>
        <N id="103" ft="3" fs="1" B="" Q="" A="" S=""/>
        <N id="104" ft="3" fs="1" B="" Q="" A="" S=""/>
        <N id="105" ft="3" fs="1" B="" Q="" A="" S=""/>
        <N id="107" ft="3" fs="1" B="" Q="" A="" S=""/>
        <N id="112" ft="3" fs="1" B="" Q="" A="" S=""/>
        <N id="24" ft="3" fs="1" Q="5" B="S" A="0"/>
        </Root>
        """;
    }

    private static string BuildBMv()
    {
        return """
    <Root>
    <N id="4" ft="3" fs="0"/>
    <N id="8" ft="3" fs="0"/>
    <N id="12" ft="3" fs="0"/>
    <N id="16" ft="3" fs="0"/>
    <N id="18" ft="3" fs="0"/>
    <N id="20" ft="3" fs="0"/>
    <N id="22" ft="3" fs="0"/>
    <N id="24" ft="3" fs="0"/>
    <N id="26" ft="3" fs="0"/>
    </Root>
    """;
    }
}