using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using SBUAPI.Data;
using SBUAPI.Options;
using SBUAPI.Services;
using System.Security.Cryptography;
using System.Threading.RateLimiting;

namespace SBUAPI
{
    public class Program
    {
        public static void Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);
            builder.Services.AddScoped<CourseSyncService>();

            builder.Services.Configure<AdminAuthOptions>(
                builder.Configuration.GetSection(AdminAuthOptions.SectionName));
            builder.Services.Configure<SiteOptions>(
                builder.Configuration.GetSection(SiteOptions.SectionName));

            var secureCookiePolicy = builder.Environment.IsDevelopment()
                ? CookieSecurePolicy.SameAsRequest
                : CookieSecurePolicy.Always;

            var dataProtection = builder.Services
                .AddDataProtection()
                .SetApplicationName("SBUAPI");

            var dataProtectionKeysPath = builder.Configuration["DataProtection:KeysPath"];
            if (!string.IsNullOrWhiteSpace(dataProtectionKeysPath))
            {
                dataProtection.PersistKeysToFileSystem(
                    new DirectoryInfo(Path.GetFullPath(dataProtectionKeysPath)));
            }

            builder.Services
                .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
                .AddCookie(options =>
                {
                    options.Cookie.Name = "SBUAPI.Admin";
                    options.Cookie.HttpOnly = true;
                    options.Cookie.SameSite = SameSiteMode.Strict;
                    options.Cookie.SecurePolicy = secureCookiePolicy;
                    options.LoginPath = "/account/login";
                    options.AccessDeniedPath = "/account/denied";
                    options.ExpireTimeSpan = TimeSpan.FromHours(8);
                    options.SlidingExpiration = false;
                });

            builder.Services.AddAuthorization();
            builder.Services.AddOutputCache(options =>
            {
                options.AddPolicy("CourseFilters", policy =>
                    policy.Expire(TimeSpan.FromMinutes(30))
                        .Tag("courses"));
                options.AddPolicy("CourseQueries", policy =>
                    policy.Expire(TimeSpan.FromSeconds(60))
                        .SetVaryByQuery("*")
                        .Tag("courses"));
                options.AddPolicy("CourseDetails", policy =>
                    policy.Expire(TimeSpan.FromMinutes(5))
                        .Tag("courses"));
            });
            var publicApiRateLimitingEnabled = builder.Configuration.GetValue(
                "RateLimiting:PublicApiEnabled",
                true
            );

            builder.Services.AddRateLimiter(options =>
            {
                options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
                options.AddPolicy("admin-login", httpContext =>
                    RateLimitPartition.GetFixedWindowLimiter(
                        httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                        _ => new FixedWindowRateLimiterOptions
                        {
                            PermitLimit = 5,
                            Window = TimeSpan.FromMinutes(1),
                            QueueLimit = 0,
                            AutoReplenishment = true
                        }));
                options.AddPolicy("public-api", httpContext =>
                    publicApiRateLimitingEnabled
                        ? RateLimitPartition.GetTokenBucketLimiter(
                        httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                        _ => new TokenBucketRateLimiterOptions
                        {
                            TokenLimit = 60,
                            TokensPerPeriod = 30,
                            ReplenishmentPeriod = TimeSpan.FromSeconds(10),
                            QueueLimit = 0,
                            AutoReplenishment = true
                        })
                        : RateLimitPartition.GetNoLimiter("public-api-disabled"));
            });

            var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
                ?? throw new InvalidOperationException(
                    "ConnectionStrings:DefaultConnection is not configured.");

            builder.Services.AddDbContext<ApplicationDbContext>(options =>
                options.UseSqlServer(connectionString));

            builder.Services.AddControllersWithViews();
            builder.Services.AddAntiforgery(options =>
            {
                options.Cookie.HttpOnly = true;
                options.Cookie.SameSite = SameSiteMode.Strict;
                options.Cookie.SecurePolicy = secureCookiePolicy;
            });

            builder.Services.AddSingleton<CourseParser>();

            builder.Services.AddHttpClient<BehestanClient>(client =>
            {
                client.BaseAddress = new Uri("https://ems.sbu.ac.ir/");
                client.Timeout = TimeSpan.FromSeconds(60);
            });

            var app = builder.Build();

            if (!app.Environment.IsDevelopment())
            {
                app.UseExceptionHandler("/Home/Error");
                app.UseHsts();
            }

            app.Use(async (context, next) =>
            {
                var cspNonce = Convert.ToBase64String(RandomNumberGenerator.GetBytes(16));
                context.Items["CspNonce"] = cspNonce;

                context.Response.Headers.XContentTypeOptions = "nosniff";
                context.Response.Headers.XFrameOptions = "DENY";
                context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
                context.Response.Headers.Append(
                    "Permissions-Policy",
                    "camera=(), microphone=(), geolocation=()");

                if (context.Request.Path.StartsWithSegments("/api") ||
                    context.Request.Path.StartsWithSegments("/Admin") ||
                    context.Request.Path.StartsWithSegments("/account"))
                {
                    context.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
                }

                if (!app.Environment.IsDevelopment())
                {
                    context.Response.Headers["Content-Security-Policy"] =
                        "default-src 'self'; base-uri 'self'; object-src 'none'; " +
                        "frame-ancestors 'none'; form-action 'self'; " +
                        "img-src 'self' data: blob:; " +
                        "font-src 'self' data: https://cdn.jsdelivr.net; " +
                        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
                        $"script-src 'self' 'nonce-{cspNonce}' https://cdn.jsdelivr.net https://code.iconify.design; " +
                        "connect-src 'self' https://api.iconify.design https://api.simplesvg.com https://api.unisvg.com";
                }

                await next();
            });

            app.UseHttpsRedirection();
            
            app.UseRouting();

            app.UseRateLimiter();
            app.UseAuthentication();
            app.UseAuthorization();
            app.UseOutputCache();

            app.MapStaticAssets();
            app.MapControllers();
            app.MapControllerRoute(
                name: "default",
                pattern: "{controller=Home}/{action=Index}/{id?}"
            )
            .WithStaticAssets();

            app.Run();
        }
    }
}
