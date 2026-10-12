; ModuleID = 'matriz.c'
source_filename = "matriz.c"
target datalayout = "e-m:e-p:32:32-i64:64-n32-S128"
target triple = "riscv32-unknown-unknown"

@A = dso_local global [9 x i32] [i32 1, i32 2, i32 3, i32 4, i32 5, i32 6, i32 7, i32 8, i32 9], align 4
@B = dso_local global [9 x i32] [i32 9, i32 8, i32 7, i32 6, i32 5, i32 4, i32 3, i32 2, i32 1], align 4
@C = dso_local global [9 x i32] zeroinitializer, align 4

; Function Attrs: noinline nounwind optnone
define dso_local void @matmul(ptr noundef %0, ptr noundef %1, ptr noundef %2, i32 noundef %3) #0 {
  %5 = alloca ptr, align 4
  %6 = alloca ptr, align 4
  %7 = alloca ptr, align 4
  %8 = alloca i32, align 4
  %9 = alloca i32, align 4
  %10 = alloca i32, align 4
  %11 = alloca i32, align 4
  %12 = alloca i32, align 4
  store ptr %0, ptr %5, align 4
  store ptr %1, ptr %6, align 4
  store ptr %2, ptr %7, align 4
  store i32 %3, ptr %8, align 4
  store i32 0, ptr %9, align 4
  br label %13

13:                                               ; preds = %63, %4
  %14 = load i32, ptr %9, align 4
  %15 = load i32, ptr %8, align 4
  %16 = icmp slt i32 %14, %15
  br i1 %16, label %17, label %66

17:                                               ; preds = %13
  store i32 0, ptr %10, align 4
  br label %18

18:                                               ; preds = %59, %17
  %19 = load i32, ptr %10, align 4
  %20 = load i32, ptr %8, align 4
  %21 = icmp slt i32 %19, %20
  br i1 %21, label %22, label %62

22:                                               ; preds = %18
  store i32 0, ptr %11, align 4
  store i32 0, ptr %12, align 4
  br label %23

23:                                               ; preds = %47, %22
  %24 = load i32, ptr %12, align 4
  %25 = load i32, ptr %8, align 4
  %26 = icmp slt i32 %24, %25
  br i1 %26, label %27, label %50

27:                                               ; preds = %23
  %28 = load ptr, ptr %5, align 4
  %29 = load i32, ptr %9, align 4
  %30 = load i32, ptr %8, align 4
  %31 = mul nsw i32 %29, %30
  %32 = load i32, ptr %12, align 4
  %33 = add nsw i32 %31, %32
  %34 = getelementptr inbounds i32, ptr %28, i32 %33
  %35 = load i32, ptr %34, align 4
  %36 = load ptr, ptr %6, align 4
  %37 = load i32, ptr %12, align 4
  %38 = load i32, ptr %8, align 4
  %39 = mul nsw i32 %37, %38
  %40 = load i32, ptr %10, align 4
  %41 = add nsw i32 %39, %40
  %42 = getelementptr inbounds i32, ptr %36, i32 %41
  %43 = load i32, ptr %42, align 4
  %44 = mul nsw i32 %35, %43
  %45 = load i32, ptr %11, align 4
  %46 = add nsw i32 %45, %44
  store i32 %46, ptr %11, align 4
  br label %47

47:                                               ; preds = %27
  %48 = load i32, ptr %12, align 4
  %49 = add nsw i32 %48, 1
  store i32 %49, ptr %12, align 4
  br label %23, !llvm.loop !5

50:                                               ; preds = %23
  %51 = load i32, ptr %11, align 4
  %52 = load ptr, ptr %7, align 4
  %53 = load i32, ptr %9, align 4
  %54 = load i32, ptr %8, align 4
  %55 = mul nsw i32 %53, %54
  %56 = load i32, ptr %10, align 4
  %57 = add nsw i32 %55, %56
  %58 = getelementptr inbounds i32, ptr %52, i32 %57
  store i32 %51, ptr %58, align 4
  br label %59

59:                                               ; preds = %50
  %60 = load i32, ptr %10, align 4
  %61 = add nsw i32 %60, 1
  store i32 %61, ptr %10, align 4
  br label %18, !llvm.loop !7

62:                                               ; preds = %18
  br label %63

63:                                               ; preds = %62
  %64 = load i32, ptr %9, align 4
  %65 = add nsw i32 %64, 1
  store i32 %65, ptr %9, align 4
  br label %13, !llvm.loop !8

66:                                               ; preds = %13
  ret void
}

; Function Attrs: noinline nounwind optnone
define dso_local i32 @main() #0 {
  %1 = alloca i32, align 4
  store i32 0, ptr %1, align 4
  call void @matmul(ptr noundef @A, ptr noundef @B, ptr noundef @C, i32 noundef 3)
  %2 = load i32, ptr @C, align 4
  %3 = load i32, ptr getelementptr inbounds ([9 x i32], ptr @C, i32 0, i32 8), align 4
  %4 = add nsw i32 %2, %3
  ret i32 %4
}

attributes #0 = { noinline nounwind optnone "frame-pointer"="all" "no-trapping-math"="true" "stack-protector-buffer-size"="8" "target-cpu"="generic-rv32" "target-features"="+32bit,+f,+m,+relax,+zicsr,-a,-c,-d,-e,-experimental-zacas,-experimental-zcmop,-experimental-zfbfmin,-experimental-zicfilp,-experimental-zicfiss,-experimental-zimop,-experimental-ztso,-experimental-zvfbfmin,-experimental-zvfbfwma,-h,-smaia,-smepmp,-ssaia,-svinval,-svnapot,-svpbmt,-v,-xcvalu,-xcvbi,-xcvbitmanip,-xcvelw,-xcvmac,-xcvmem,-xcvsimd,-xsfvcp,-xsfvfnrclipxfqf,-xsfvfwmaccqqq,-xsfvqmaccdod,-xsfvqmaccqoq,-xtheadba,-xtheadbb,-xtheadbs,-xtheadcmo,-xtheadcondmov,-xtheadfmemidx,-xtheadmac,-xtheadmemidx,-xtheadmempair,-xtheadsync,-xtheadvdot,-xventanacondops,-za128rs,-za64rs,-zawrs,-zba,-zbb,-zbc,-zbkb,-zbkc,-zbkx,-zbs,-zca,-zcb,-zcd,-zce,-zcf,-zcmp,-zcmt,-zdinx,-zfa,-zfh,-zfhmin,-zfinx,-zhinx,-zhinxmin,-zic64b,-zicbom,-zicbop,-zicboz,-ziccamoa,-ziccif,-zicclsm,-ziccrse,-zicntr,-zicond,-zifencei,-zihintntl,-zihintpause,-zihpm,-zk,-zkn,-zknd,-zkne,-zknh,-zkr,-zks,-zksed,-zksh,-zkt,-zmmul,-zvbb,-zvbc,-zve32f,-zve32x,-zve64d,-zve64f,-zve64x,-zvfh,-zvfhmin,-zvkb,-zvkg,-zvkn,-zvknc,-zvkned,-zvkng,-zvknha,-zvknhb,-zvks,-zvksc,-zvksed,-zvksg,-zvksh,-zvkt,-zvl1024b,-zvl128b,-zvl16384b,-zvl2048b,-zvl256b,-zvl32768b,-zvl32b,-zvl4096b,-zvl512b,-zvl64b,-zvl65536b,-zvl8192b" }

!llvm.module.flags = !{!0, !1, !2, !3}
!llvm.ident = !{!4}

!0 = !{i32 1, !"wchar_size", i32 4}
!1 = !{i32 1, !"target-abi", !"ilp32f"}
!2 = !{i32 7, !"frame-pointer", i32 2}
!3 = !{i32 8, !"SmallDataLimit", i32 8}
!4 = !{!"Ubuntu clang version 18.1.3 (1ubuntu1)"}
!5 = distinct !{!5, !6}
!6 = !{!"llvm.loop.mustprogress"}
!7 = distinct !{!7, !6}
!8 = distinct !{!8, !6}
