using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using SBUAPI.Models;
using SBUAPI.Options;

namespace SBUAPI.Controllers;

[Route("account")]
[ResponseCache(Location = ResponseCacheLocation.None, NoStore = true)]
public sealed class AccountController : Controller
{
    private readonly AdminAuthOptions _adminAuth;
    private readonly ILogger<AccountController> _logger;

    public AccountController(
        IOptions<AdminAuthOptions> adminAuth,
        ILogger<AccountController> logger)
    {
        _adminAuth = adminAuth.Value;
        _logger = logger;
    }

    [AllowAnonymous]
    [HttpGet("login")]
    public IActionResult Login(string? returnUrl = null)
    {
        if (User.Identity?.IsAuthenticated == true)
            return RedirectToAction("Index", "Admin");

        return View(new AdminLoginViewModel
        {
            ReturnUrl = Url.IsLocalUrl(returnUrl) ? returnUrl : null
        });
    }

    [AllowAnonymous]
    [HttpPost("login")]
    [ValidateAntiForgeryToken]
    [EnableRateLimiting("admin-login")]
    [RequestSizeLimit(16 * 1024)]
    public async Task<IActionResult> Login(
        AdminLoginViewModel model,
        CancellationToken cancellationToken)
    {
        var returnUrl = Url.IsLocalUrl(model.ReturnUrl) ? model.ReturnUrl : null;

        if (!ModelState.IsValid)
        {
            model.Password = "";
            model.ReturnUrl = returnUrl;
            return View(model);
        }

        var isConfigured = !string.IsNullOrWhiteSpace(_adminAuth.Username) &&
                           !string.IsNullOrWhiteSpace(_adminAuth.Password);

        var usernameMatches = FixedTimeEquals(model.Username, _adminAuth.Username);
        var passwordMatches = FixedTimeEquals(model.Password, _adminAuth.Password);

        if (!isConfigured || !usernameMatches || !passwordMatches)
        {
            _logger.LogWarning(
                "Rejected admin login attempt from {RemoteIp}.",
                HttpContext.Connection.RemoteIpAddress);

            ModelState.AddModelError(string.Empty, "نام کاربری یا رمز عبور نادرست است.");
            model.Password = "";
            model.ReturnUrl = returnUrl;
            return View(model);
        }

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, _adminAuth.Username),
            new Claim(ClaimTypes.Name, _adminAuth.Username),
            new Claim(ClaimTypes.Role, "Administrator")
        };

        var principal = new ClaimsPrincipal(
            new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme));

        await HttpContext.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            principal,
            new AuthenticationProperties
            {
                IsPersistent = false,
                AllowRefresh = false,
                ExpiresUtc = DateTimeOffset.UtcNow.AddHours(8)
            });

        return LocalRedirect(returnUrl ?? Url.Action("Index", "Admin")!);
    }

    [Authorize]
    [HttpPost("logout")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Logout()
    {
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return RedirectToAction(nameof(Login));
    }

    [AllowAnonymous]
    [HttpGet("denied")]
    public IActionResult Denied() => StatusCode(StatusCodes.Status403Forbidden);

    private static bool FixedTimeEquals(string supplied, string expected)
    {
        var suppliedHash = SHA256.HashData(Encoding.UTF8.GetBytes(supplied ?? ""));
        var expectedHash = SHA256.HashData(Encoding.UTF8.GetBytes(expected ?? ""));
        return CryptographicOperations.FixedTimeEquals(suppliedHash, expectedHash);
    }
}
