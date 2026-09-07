using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.RateLimiting;
using SBUAPI.Data;
using SBUAPI.Dtos;

namespace SBUAPI.Controllers;

[ApiController]
[Route("api/schedule")]
[EnableRateLimiting("public-api")]
public sealed class ScheduleController : ControllerBase
{
    private readonly ApplicationDbContext _db;

    public ScheduleController(ApplicationDbContext db)
    {
        _db = db;
    }

    [HttpPost("check")]
    [RequestSizeLimit(16 * 1024)]
    public async Task<IActionResult> CheckSchedule(
        [FromBody] ScheduleCheckRequest request,
        CancellationToken cancellationToken)
    {
        if (request.CourseIds is null || request.CourseIds.Count == 0)
        {
            return BadRequest(new
            {
                message = "حداقل یک درس انتخاب کنید."
            });
        }


        if (request.CourseIds.Count > 100)
        {
            return BadRequest(new
            {
                message = "در هر درخواست حداکثر ۱۰۰ درس قابل بررسی است."
            });
        }

        var requestedIds = request.CourseIds
            .Distinct()
            .ToList();

        var courses = await _db.Courses
            .AsNoTracking()
            .Where(c =>
                requestedIds.Contains(c.Id) &&
                c.IsActive
            )
            .Select(c => new
            {
                c.Id,
                c.CourseCode,
                c.Group,
                c.Name,
                c.Units,

                Professors = c.Professors
                    .Select(p => p.Name)
                    .ToList(),

                Meetings = c.Meetings
                    .Select(m => new
                    {
                        m.Type,
                        m.Day,
                        m.StartTime,
                        m.EndTime
                    })
                    .ToList(),

                Exam = c.Exam == null
                    ? null
                    : new
                    {
                        c.Exam.Date,
                        c.Exam.StartTime,
                        c.Exam.EndTime
                    }
            })
            .ToListAsync(cancellationToken);

        var foundIds = courses
            .Select(c => c.Id)
            .ToHashSet();

        var missingIds = requestedIds
            .Where(id => !foundIds.Contains(id))
            .ToList();

        var classConflicts = new List<ScheduleConflictDto>();
        var examConflicts = new List<ScheduleConflictDto>();

        for (var i = 0; i < courses.Count; i++)
        {
            for (var j = i + 1; j < courses.Count; j++)
            {
                var first = courses[i];
                var second = courses[j];


                foreach (var firstMeeting in first.Meetings)
                {
                    foreach (var secondMeeting in second.Meetings)
                    {
                        if (!string.Equals(
                                firstMeeting.Day.Trim(),
                                secondMeeting.Day.Trim(),
                                StringComparison.Ordinal))
                        {
                            continue;
                        }

                        if (!TimesOverlap(
                                firstMeeting.StartTime,
                                firstMeeting.EndTime,
                                secondMeeting.StartTime,
                                secondMeeting.EndTime))
                        {
                            continue;
                        }

                        classConflicts.Add(
                            new ScheduleConflictDto
                            {
                                Type = "class",

                                FirstCourseId = first.Id,
                                FirstCourseName = first.Name,

                                SecondCourseId = second.Id,
                                SecondCourseName = second.Name,

                                DayOrDate = firstMeeting.Day,

                                FirstTime =
                                    $"{firstMeeting.StartTime}-{firstMeeting.EndTime}",

                                SecondTime =
                                    $"{secondMeeting.StartTime}-{secondMeeting.EndTime}"
                            }
                        );
                    }
                }


                if (first.Exam is null ||
                    second.Exam is null)
                {
                    continue;
                }

                if (string.IsNullOrWhiteSpace(first.Exam.Date) ||
                    string.IsNullOrWhiteSpace(second.Exam.Date))
                {
                    continue;
                }

                if (!string.Equals(
                        first.Exam.Date.Trim(),
                        second.Exam.Date.Trim(),
                        StringComparison.Ordinal))
                {
                    continue;
                }

                if (!TimesOverlap(
                        first.Exam.StartTime,
                        first.Exam.EndTime,
                        second.Exam.StartTime,
                        second.Exam.EndTime))
                {
                    continue;
                }

                examConflicts.Add(
                    new ScheduleConflictDto
                    {
                        Type = "exam",

                        FirstCourseId = first.Id,
                        FirstCourseName = first.Name,

                        SecondCourseId = second.Id,
                        SecondCourseName = second.Name,

                        DayOrDate = first.Exam.Date,

                        FirstTime =
                            $"{first.Exam.StartTime}-{first.Exam.EndTime}",

                        SecondTime =
                            $"{second.Exam.StartTime}-{second.Exam.EndTime}"
                    }
                );
            }
        }

        var totalUnits = courses.Sum(c => c.Units);

        return Ok(new
        {
            selectedCount = courses.Count,
            totalUnits,

            hasConflict =
                classConflicts.Count > 0 ||
                examConflicts.Count > 0,

            missingCourseIds = missingIds,

            classConflicts,
            examConflicts,

            courses
        });
    }

    private static bool TimesOverlap(
        string firstStart,
        string firstEnd,
        string secondStart,
        string secondEnd)
    {
        if (!TryParseTime(firstStart, out var start1) ||
            !TryParseTime(firstEnd, out var end1) ||
            !TryParseTime(secondStart, out var start2) ||
            !TryParseTime(secondEnd, out var end2))
        {
            return false;
        }

        return start1 < end2 &&
               start2 < end1;
    }

    private static bool TryParseTime(
        string value,
        out TimeOnly time)
    {
        return TimeOnly.TryParseExact(
            value.Trim(),
            "HH:mm",
            CultureInfo.InvariantCulture,
            DateTimeStyles.None,
            out time
        );
    }
}
