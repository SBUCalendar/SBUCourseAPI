using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.OutputCaching;
using Microsoft.AspNetCore.RateLimiting;
using SBUAPI.Data;
using SBUAPI.Dtos;
using SBUAPI.Services;

namespace SBUAPI.Controllers;

[ApiController]
[Route("api/courses")]
[EnableRateLimiting("public-api")]
public sealed class CoursesController : ControllerBase
{
    private readonly ApplicationDbContext _db;

    public CoursesController(ApplicationDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    [OutputCache(PolicyName = "CourseQueries")]
    public async Task<IActionResult> GetCourses(
        [FromQuery] CourseQuery request,
        CancellationToken cancellationToken)
    {
        request.Page = Math.Clamp(request.Page, 1, 10_000);
        request.PageSize = Math.Clamp(request.PageSize, 1, 100);

        var search = PersianTextNormalizer.Normalize(request.Search);

        var query = _db.Courses
            .AsNoTracking()
            .Where(c => c.IsActive);


        if (search.Length > 0)
        {
            query = query.Where(c =>
                c.Name.Replace("ي", "ی").Replace("ى", "ی").Replace("ك", "ک").Contains(search) ||
                c.CourseCode.Contains(search) ||
                c.FacultyName.Replace("ي", "ی").Replace("ى", "ی").Replace("ك", "ک").Contains(search) ||
                c.DepartmentName.Replace("ي", "ی").Replace("ى", "ی").Replace("ك", "ک").Contains(search) ||
                c.Professors.Any(p =>
                    p.Name.Replace("ي", "ی").Replace("ى", "ی").Replace("ك", "ک").Contains(search)
                )
            );
        }


        if (!string.IsNullOrWhiteSpace(request.Professor))
        {
            var professor = PersianTextNormalizer.Normalize(request.Professor);

            query = query.Where(c =>
                c.Professors.Any(p =>
                    p.Name.Replace("ي", "ی").Replace("ى", "ی").Replace("ك", "ک").Contains(professor)
                )
            );
        }


        if (!string.IsNullOrWhiteSpace(request.Faculty))
        {
            var faculty = PersianTextNormalizer.Normalize(request.Faculty);

            query = query.Where(c =>
                c.FacultyName.Replace("ي", "ی").Replace("ى", "ی").Replace("ك", "ک").Contains(faculty) ||
                c.Restrictions.Replace("ي", "ی").Replace("ى", "ی").Replace("ك", "ک").Contains(faculty)
            );
        }


        if (!string.IsNullOrWhiteSpace(request.Department))
        {
            var department = PersianTextNormalizer.Normalize(request.Department);

            query = query.Where(c =>
                c.DepartmentName.Replace("ي", "ی").Replace("ى", "ی").Replace("ك", "ک").Contains(department) ||
                c.Restrictions.Replace("ي", "ی").Replace("ى", "ی").Replace("ك", "ک").Contains(department)
            );
        }


        if (!string.IsNullOrWhiteSpace(request.Day))
        {
            var day = request.Day.Trim();

            query = query.Where(c =>
                c.Meetings.Any(m =>
                    m.Day == day
                )
            );
        }


        if (request.Units.HasValue)
        {
            query = query.Where(c =>
                c.Units == request.Units.Value
            );
        }


        if (!string.IsNullOrWhiteSpace(request.Gender))
        {
            var gender = request.Gender.Trim();

            query = query.Where(c =>
                c.Gender == gender
            );
        }


        var totalCount = await query.CountAsync(
            cancellationToken
        );


        var sortBy =
            request.SortBy?
                .Trim()
                .ToLowerInvariant()
            ?? "name";

        var descending =
            string.Equals(
                request.SortOrder,
                "desc",
                StringComparison.OrdinalIgnoreCase
            );

        var orderedQuery = sortBy switch
        {
            "relevance" when search.Length > 0 => query
                .OrderByDescending(c =>
                    c.CourseCode == search ? 8 :
                    c.Name.Replace("ي", "ی").Replace("ى", "ی").Replace("ك", "ک") == search ? 7 :
                    c.CourseCode.StartsWith(search) ? 6 :
                    c.Name.Replace("ي", "ی").Replace("ى", "ی").Replace("ك", "ک").StartsWith(search) ? 5 :
                    c.Professors.Any(p => p.Name.Replace("ي", "ی").Replace("ى", "ی").Replace("ك", "ک").StartsWith(search)) ? 4 :
                    c.CourseCode.Contains(search) ? 3 :
                    c.Name.Replace("ي", "ی").Replace("ى", "ی").Replace("ك", "ک").Contains(search) ? 2 :
                    c.Professors.Any(p => p.Name.Replace("ي", "ی").Replace("ى", "ی").Replace("ك", "ک").Contains(search)) ? 1 :
                    0
                )
                .ThenBy(c => c.Name)
                .ThenBy(c => c.Id),

            "code" => descending
                ? query
                    .OrderByDescending(c => c.CourseCode)
                    .ThenByDescending(c => c.Group)
                    .ThenByDescending(c => c.Id)
                : query
                    .OrderBy(c => c.CourseCode)
                    .ThenBy(c => c.Group)
                    .ThenBy(c => c.Id),

            "capacity" => descending
                ? query
                    .OrderByDescending(c => c.Capacity)
                    .ThenBy(c => c.Id)
                : query
                    .OrderBy(c => c.Capacity)
                    .ThenBy(c => c.Id),

            "registered" => descending
                ? query
                    .OrderByDescending(c => c.Registered)
                    .ThenBy(c => c.Id)
                : query
                    .OrderBy(c => c.Registered)
                    .ThenBy(c => c.Id),

            "units" => descending
                ? query
                    .OrderByDescending(c => c.Units)
                    .ThenBy(c => c.Id)
                : query
                    .OrderBy(c => c.Units)
                    .ThenBy(c => c.Id),

            "examdate" => descending
                ? query
                    .OrderByDescending(c =>
                        c.Exam != null
                            ? c.Exam.Date
                            : ""
                    )
                    .ThenBy(c => c.Id)
                : query
                    .OrderBy(c =>
                        c.Exam != null
                            ? c.Exam.Date
                            : ""
                    )
                    .ThenBy(c => c.Id),

            _ => descending
                ? query
                    .OrderByDescending(c => c.Name)
                    .ThenBy(c => c.Id)
                : query
                    .OrderBy(c => c.Name)
                    .ThenBy(c => c.Id)
        };


        var items = await orderedQuery
            .Skip(
                (request.Page - 1)
                * request.PageSize
            )
            .Take(request.PageSize)
            .Select(c => new CourseListItemDto
            {
                Id = c.Id,

                CourseCode = c.CourseCode,
                Group = c.Group,
                Name = c.Name,

                Units = c.Units,
                PracticalUnits =
                    c.PracticalUnits,

                FacultyName =
                    c.FacultyName,

                DepartmentName =
                    c.DepartmentName,

                Capacity = c.Capacity,
                Registered = c.Registered,
                Waitlist = c.Waitlist,

                Gender = c.Gender,
                Restrictions = c.Restrictions,
                Notes = c.Notes,

                Professors = c.Professors
                    .Select(p => p.Name)
                    .ToList(),

                Meetings = c.Meetings
                    .Select(m =>
                        new CourseMeetingDto
                        {
                            Type = m.Type,
                            Day = m.Day,
                            StartTime =
                                m.StartTime,
                            EndTime =
                                m.EndTime
                        }
                    )
                    .ToList(),

                Exam = c.Exam == null
                    ? null
                    : new CourseExamDto
                    {
                        Date = c.Exam.Date,
                        StartTime =
                            c.Exam.StartTime,
                        EndTime =
                            c.Exam.EndTime
                    }
            })
            .ToListAsync(cancellationToken);

        var totalPages =
            totalCount == 0
                ? 0
                : (int)Math.Ceiling(
                    totalCount /
                    (double)request.PageSize
                );

        return Ok(new
        {
            page = request.Page,
            pageSize = request.PageSize,
            totalCount,
            totalPages,
            items
        });
    }

    [HttpGet("filters")]
    [OutputCache(PolicyName = "CourseFilters")]
    public async Task<IActionResult> GetFilters(
        CancellationToken cancellationToken)
    {

        var faculties = await _db.Courses
            .AsNoTracking()
            .Where(c =>
                c.IsActive &&
                c.FacultyName != ""
            )
            .Select(c => new
            {
                code = c.FacultyCode,
                name = c.FacultyName
            })
            .Distinct()
            .OrderBy(x => x.name)
            .ToListAsync(cancellationToken);


        var departments = await _db.Courses
            .AsNoTracking()
            .Where(c =>
                c.IsActive &&
                c.DepartmentName != ""
            )
            .Select(c => new
            {
                facultyCode =
                    c.FacultyCode,

                code =
                    c.DepartmentCode,

                name =
                    c.DepartmentName
            })
            .Distinct()
            .OrderBy(x => x.name)
            .ToListAsync(cancellationToken);


        var professors =
            await _db.CourseProfessors
                .AsNoTracking()
                .Where(p =>
                    p.Course.IsActive &&
                    p.Name != ""
                )
                .Select(p => p.Name)
                .Distinct()
                .OrderBy(x => x)
                .ToListAsync(
                    cancellationToken
                );


        var days =
            await _db.CourseMeetings
                .AsNoTracking()
                .Where(m =>
                    m.Course.IsActive &&
                    m.Day != ""
                )
                .Select(m => m.Day)
                .Distinct()
                .OrderBy(x => x)
                .ToListAsync(
                    cancellationToken
                );


        var units = await _db.Courses
            .AsNoTracking()
            .Where(c => c.IsActive)
            .Select(c => c.Units)
            .Distinct()
            .OrderBy(x => x)
            .ToListAsync(
                cancellationToken
            );


        var genders = await _db.Courses
            .AsNoTracking()
            .Where(c =>
                c.IsActive &&
                c.Gender != ""
            )
            .Select(c => c.Gender)
            .Distinct()
            .OrderBy(x => x)
            .ToListAsync(
                cancellationToken
            );

        return Ok(new
        {
            faculties,
            departments,
            professors,
            days,
            units,
            genders
        });
    }

    [HttpGet("{id:int}")]
    [OutputCache(PolicyName = "CourseDetails")]
    public async Task<IActionResult> GetCourse(
        int id,
        CancellationToken cancellationToken)
    {
        var course = await _db.Courses
            .AsNoTracking()
            .Where(c =>
                c.Id == id &&
                c.IsActive
            )
            .Select(c =>
                new CourseDetailsDto
                {
                    Id = c.Id,

                    TermCode =
                        c.TermCode,

                    CourseCode =
                        c.CourseCode,

                    Group =
                        c.Group,

                    Name =
                        c.Name,

                    Units =
                        c.Units,

                    PracticalUnits =
                        c.PracticalUnits,

                    FacultyCode =
                        c.FacultyCode,

                    FacultyName =
                        c.FacultyName,

                    DepartmentCode =
                        c.DepartmentCode,

                    DepartmentName =
                        c.DepartmentName,

                    Capacity =
                        c.Capacity,

                    Registered =
                        c.Registered,

                    Waitlist =
                        c.Waitlist,

                    Gender =
                        c.Gender,

                    Professors =
                        c.Professors
                            .Select(p =>
                                p.Name
                            )
                            .ToList(),

                    Meetings =
                        c.Meetings
                            .Select(m =>
                                new CourseMeetingDto
                                {
                                    Type =
                                        m.Type,

                                    Day =
                                        m.Day,

                                    StartTime =
                                        m.StartTime,

                                    EndTime =
                                        m.EndTime
                                }
                            )
                            .ToList(),

                    Exam =
                        c.Exam == null
                            ? null
                            : new CourseExamDto
                            {
                                Date =
                                    c.Exam.Date,

                                StartTime =
                                    c.Exam
                                        .StartTime,

                                EndTime =
                                    c.Exam
                                        .EndTime
                            },

                    Restrictions =
                        c.Restrictions,

                    EntryRestriction =
                        c.EntryRestriction,

                    ConflictingCourses =
                        c.ConflictingCourses,

                    OfferingMethod =
                        c.OfferingMethod,

                    CoursePeriod =
                        c.CoursePeriod,

                    Notes =
                        c.Notes
                }
            )
            .FirstOrDefaultAsync(
                cancellationToken
            );

        if (course is null)
        {
            return NotFound(new
            {
                message =
                    "درس موردنظر پیدا نشد."
            });
        }

        return Ok(course);
    }

}
