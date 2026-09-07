using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using SBUAPI.Models;
using SBUAPI.Services;
using SbuCourses.Models;

namespace SBUAPI.Controllers;

[Authorize(Roles = "Administrator")]
[ResponseCache(Location = ResponseCacheLocation.None, NoStore = true)]
public class AdminController : Controller
{
    private readonly BehestanClient _behestanClient;
    private readonly CourseParser _courseParser;
    private readonly CourseSyncService _courseSyncService;

    public AdminController(
        BehestanClient behestanClient,
        CourseParser courseParser,
        CourseSyncService courseSyncService)
    {
        _behestanClient = behestanClient;
        _courseParser = courseParser;
        _courseSyncService = courseSyncService;
    }

    [HttpGet]
    public IActionResult Index()
    {
        return View(new AdminBehestanViewModel());
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    [RequestSizeLimit(32 * 1024)]
    public async Task<IActionResult> TestSession(
        AdminBehestanViewModel model,
        CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
            return InvalidSessionInput();

        var result = await _behestanClient.FetchCoursesAsync(
            model.Session,
            cancellationToken
        );

        var count = 0;

        if (result.Success &&
            !string.IsNullOrWhiteSpace(result.BMt))
        {
            var courses = _courseParser.Parse(result.BMt);
            count = courses.Count;
        }

        ModelState.Clear();

        return View("Index", new AdminBehestanViewModel
        {
            Success = result.Success,
            CourseCount = count,
            Message = result.Success
                ? $"ارتباط موفق بود. {count} درس Parse شد."
                : result.Error ?? $"خطا، ret={result.Ret}"
        });
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    [RequestSizeLimit(32 * 1024)]
    public async Task<IActionResult> UpdateCourses(
        AdminBehestanViewModel model,
        CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
            return InvalidSessionInput();

        var result = await _courseSyncService.SyncAsync(
            model.Session,
            cancellationToken
        );

        ModelState.Clear();

        return View("Index", new AdminBehestanViewModel
        {
            Success = result.Success,
            CourseCount = result.CourseCount,
            Message = result.Message
        });
    }

    private IActionResult InvalidSessionInput()
    {
        ModelState.Clear();
        return View("Index", new AdminBehestanViewModel
        {
            Success = false,
            Message = "همه مقادیر نشست بهستان را وارد کنید. مقادیر حساس نگهداری نشدند."
        });
    }
}
