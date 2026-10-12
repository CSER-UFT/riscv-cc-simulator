; ModuleID = 'saxpy.c'
source_filename = "saxpy.c"
target datalayout = "e-m:e-p:32:32-i64:64-n32-S128"
target triple = "riscv32-unknown-unknown"

@x = dso_local global [4 x float] [float 1.000000e+00, float 2.000000e+00, float 3.000000e+00, float 4.000000e+00], align 4
@y = dso_local global [4 x float] [float 5.000000e-01, float 5.000000e-01, float 5.000000e-01, float 5.000000e-01], align 4

; Function Attrs: noinline nounwind optnone
define dso_local void @saxpy(i32 noundef %0, float noundef %1, ptr noundef %2, ptr noundef %3) #0 {
  %5 = alloca i32, align 4
  %6 = alloca float, align 4
  %7 = alloca ptr, align 4
  %8 = alloca ptr, align 4
  %9 = alloca i32, align 4
  store i32 %0, ptr %5, align 4
  store float %1, ptr %6, align 4
  store ptr %2, ptr %7, align 4
  store ptr %3, ptr %8, align 4
  store i32 0, ptr %9, align 4
  br label %10

10:                                               ; preds = %28, %4
  %11 = load i32, ptr %9, align 4
  %12 = load i32, ptr %5, align 4
  %13 = icmp slt i32 %11, %12
  br i1 %13, label %14, label %31

14:                                               ; preds = %10
  %15 = load float, ptr %6, align 4
  %16 = load ptr, ptr %7, align 4
  %17 = load i32, ptr %9, align 4
  %18 = getelementptr inbounds float, ptr %16, i32 %17
  %19 = load float, ptr %18, align 4
  %20 = load ptr, ptr %8, align 4
  %21 = load i32, ptr %9, align 4
  %22 = getelementptr inbounds float, ptr %20, i32 %21
  %23 = load float, ptr %22, align 4
  %24 = call float @llvm.fmuladd.f32(float %15, float %19, float %23)
  %25 = load ptr, ptr %8, align 4
  %26 = load i32, ptr %9, align 4
  %27 = getelementptr inbounds float, ptr %25, i32 %26
  store float %24, ptr %27, align 4
  br label %28

28:                                               ; preds = %14
  %29 = load i32, ptr %9, align 4
  %30 = add nsw i32 %29, 1
  store i32 %30, ptr %9, align 4
  br label %10, !llvm.loop !5

31:                                               ; preds = %10
  ret void
}

; Function Attrs: nocallback nofree nosync nounwind speculatable willreturn memory(none)
declare float @llvm.fmuladd.f32(float, float, float) #1

; Function Attrs: noinline nounwind optnone
define dso_local i32 @main() #0 {
  %1 = alloca i32, align 4
  %2 = alloca float, align 4
  %3 = alloca i32, align 4
  store i32 0, ptr %1, align 4
  call void @saxpy(i32 noundef 4, float noundef 2.000000e+00, ptr noundef @x, ptr noundef @y)
  store float 0.000000e+00, ptr %2, align 4
  store i32 0, ptr %3, align 4
  br label %4

4:                                                ; preds = %13, %0
  %5 = load i32, ptr %3, align 4
  %6 = icmp slt i32 %5, 4
  br i1 %6, label %7, label %16

7:                                                ; preds = %4
  %8 = load i32, ptr %3, align 4
  %9 = getelementptr inbounds [4 x float], ptr @y, i32 0, i32 %8
  %10 = load float, ptr %9, align 4
  %11 = load float, ptr %2, align 4
  %12 = fadd float %11, %10
  store float %12, ptr %2, align 4
  br label %13

13:                                               ; preds = %7
  %14 = load i32, ptr %3, align 4
  %15 = add nsw i32 %14, 1
  store i32 %15, ptr %3, align 4
  br label %4, !llvm.loop !7

16:                                               ; preds = %4
  %17 = load float, ptr %2, align 4
  %18 = fmul float %17, 2.000000e+00
  %19 = fptosi float %18 to i32
  ret i32 %19
}

attributes #0 = { noinline nounwind optnone "frame-pointer"="all" "no-trapping-math"="true" "stack-protector-buffer-size"="8" "target-cpu"="generic-rv32" "target-features"="+32bit,+f,+m,+relax,+zicsr,-a,-c,-d,-e,-experimental-zacas,-experimental-zcmop,-experimental-zfbfmin,-experimental-zicfilp,-experimental-zicfiss,-experimental-zimop,-experimental-ztso,-experimental-zvfbfmin,-experimental-zvfbfwma,-h,-smaia,-smepmp,-ssaia,-svinval,-svnapot,-svpbmt,-v,-xcvalu,-xcvbi,-xcvbitmanip,-xcvelw,-xcvmac,-xcvmem,-xcvsimd,-xsfvcp,-xsfvfnrclipxfqf,-xsfvfwmaccqqq,-xsfvqmaccdod,-xsfvqmaccqoq,-xtheadba,-xtheadbb,-xtheadbs,-xtheadcmo,-xtheadcondmov,-xtheadfmemidx,-xtheadmac,-xtheadmemidx,-xtheadmempair,-xtheadsync,-xtheadvdot,-xventanacondops,-za128rs,-za64rs,-zawrs,-zba,-zbb,-zbc,-zbkb,-zbkc,-zbkx,-zbs,-zca,-zcb,-zcd,-zce,-zcf,-zcmp,-zcmt,-zdinx,-zfa,-zfh,-zfhmin,-zfinx,-zhinx,-zhinxmin,-zic64b,-zicbom,-zicbop,-zicboz,-ziccamoa,-ziccif,-zicclsm,-ziccrse,-zicntr,-zicond,-zifencei,-zihintntl,-zihintpause,-zihpm,-zk,-zkn,-zknd,-zkne,-zknh,-zkr,-zks,-zksed,-zksh,-zkt,-zmmul,-zvbb,-zvbc,-zve32f,-zve32x,-zve64d,-zve64f,-zve64x,-zvfh,-zvfhmin,-zvkb,-zvkg,-zvkn,-zvknc,-zvkned,-zvkng,-zvknha,-zvknhb,-zvks,-zvksc,-zvksed,-zvksg,-zvksh,-zvkt,-zvl1024b,-zvl128b,-zvl16384b,-zvl2048b,-zvl256b,-zvl32768b,-zvl32b,-zvl4096b,-zvl512b,-zvl64b,-zvl65536b,-zvl8192b" }
attributes #1 = { nocallback nofree nosync nounwind speculatable willreturn memory(none) }

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
