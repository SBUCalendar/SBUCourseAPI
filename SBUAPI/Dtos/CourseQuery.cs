using System.ComponentModel.DataAnnotations;

namespace SBUAPI.Dtos;

public sealed class CourseQuery
{
    [StringLength(200)]
    public string? Search { get; set; }

    [StringLength(200)]
    public string? Professor { get; set; }

    [StringLength(200)]
    public string? Faculty { get; set; }

    [StringLength(200)]
    public string? Department { get; set; }

    [StringLength(50)]
    public string? Day { get; set; }

    public int? Units { get; set; }

    [StringLength(50)]
    public string? Gender { get; set; }

    [StringLength(32)]
    public string SortBy { get; set; } = "name";

    [StringLength(8)]
    public string SortOrder { get; set; } = "asc";

    public int Page { get; set; } = 1;

    public int PageSize { get; set; } = 20;
}
